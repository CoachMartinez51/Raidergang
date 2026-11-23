-- =====================================================================
-- The Raidergang — Stage 4: connections to Google
--   1. Coaching Database → app library sync (the sheet wins)
--   2. Nightly backup export (read by a Google Apps Script)
--   3. YouTube bullpen videos (@WrightStatePitching), matched to athletes
--
-- The Google side runs as small Apps Scripts in the coaches' own Google
-- accounts. Each script proves who it is with a long random token.
-- Only a fingerprint (SHA-256) of each token is kept here.
--
-- Safe to re-run. Re-running the LAST statement issues NEW tokens,
-- and the old ones stop working.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Script tokens (no one can read this table through the app)
-- ---------------------------------------------------------------------
create table if not exists public.integration_tokens (
  name       text primary key check (name in ('coach_sheet', 'youtube')),
  token_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.integration_tokens enable row level security;
revoke all on public.integration_tokens from public, anon, authenticated;

create or replace function public._token_ok(p_name text, p_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.integration_tokens
    where name = p_name
      and token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  )
$$;
revoke execute on function public._token_ok(text, text) from public, anon, authenticated;

create or replace function public.issue_integration_tokens()
returns table (script text, token text)
language plpgsql security definer set search_path = public, extensions as $$
declare n text; t text;
begin
  foreach n in array array['coach_sheet', 'youtube'] loop
    t := encode(extensions.gen_random_bytes(24), 'hex');
    insert into public.integration_tokens (name, token_hash)
    values (n, encode(extensions.digest(t, 'sha256'), 'hex'))
    on conflict (name) do update set token_hash = excluded.token_hash, created_at = now();
    script := case n when 'coach_sheet' then 'Coaching Database script' else 'YouTube script' end;
    token := t;
    return next;
  end loop;
end $$;
revoke execute on function public.issue_integration_tokens() from public, anon, authenticated;

-- =====================================================================
-- 1. Library sync: Coaching Database → app. The sheet wins.
--    New names are added. Matching names take the sheet's category,
--    subcategory, body area, video and "also fits". Nothing is deleted:
--    exercises that are only in the app are left alone and counted.
-- =====================================================================
create table if not exists public.library_sync_log (
  id             bigserial primary key,
  ran_at         timestamptz not null default now(),
  ex_in_sheet    int not null,
  ex_added       int not null,
  ex_updated     int not null,
  drills_in_sheet int not null,
  drills_added   int not null,
  drills_updated int not null,
  app_only       int not null,
  skipped        jsonb not null default '[]'
);
alter table public.library_sync_log enable row level security;
drop policy if exists "coaches read sync log" on public.library_sync_log;
create policy "coaches read sync log" on public.library_sync_log for select to authenticated using (public.is_coach());
grant select on public.library_sync_log to authenticated;

create or replace function public._clean(t text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')), '')
$$;

create or replace function public.sheet_sync_library(p_token text, p_exercises jsonb, p_drills jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_id uuid; n int;
  v_name text; v_cat text; v_sub text; v_area text; v_video text; v_also text; v_type text; v_reps text; v_balls text;
  seen_ex text[] := '{}'; seen_dr text[] := '{}';
  ex_add int := 0; ex_upd int := 0; dr_add int := 0; dr_upd int := 0; v_app_only int;
  skipped jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if not public._token_ok('coach_sheet', p_token) then
    raise exception 'This script is not allowed to sync. Check the token at the top of the script.';
  end if;
  if jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_array_length(p_exercises) < 50 then
    raise exception 'Only % exercises came through, so nothing was changed. Is the Exercise Library tab still named the same?',
      coalesce(jsonb_array_length(p_exercises), 0);
  end if;

  -- exercises
  for r in select * from jsonb_array_elements(p_exercises) loop
    v_name := public._clean(r->>'name');
    continue when v_name is null;
    if lower(v_name) = any(seen_ex) then
      skipped := skipped || jsonb_build_object('tab', 'Exercise Library', 'name', v_name, 'why', 'listed more than once; the first row was used');
      continue;
    end if;
    seen_ex := seen_ex || lower(v_name);
    v_cat   := coalesce(public._clean(r->>'category'), 'Needs Review');
    v_sub   := public._clean(r->>'subcategory');
    v_area  := public._clean(r->>'body_area');
    v_video := public._clean(r->>'video');
    v_also  := public._clean(r->>'also_fits');

    select id into v_id from public.exercises where lower(name) = lower(v_name);
    if v_id is null then
      select id into v_id from public.exercises e
      where exists (select 1 from unnest(e.old_names) o where lower(o) = lower(v_name))
      limit 1;
    end if;

    if v_id is null then
      insert into public.exercises (name, category, subcategory, body_area, video_url, also_fits)
      values (v_name, v_cat, v_sub, v_area, v_video, v_also);
      ex_add := ex_add + 1;
    else
      update public.exercises e
         set name = v_name, category = v_cat, subcategory = v_sub, body_area = v_area,
             video_url = v_video, also_fits = v_also, active = true,
             old_names = case when lower(e.name) <> lower(v_name) and not (e.name = any(e.old_names))
                              then e.old_names || e.name else e.old_names end
       where e.id = v_id
         and (e.name, e.category, e.subcategory, e.body_area, e.video_url, e.also_fits, e.active)
             is distinct from (v_name, v_cat, v_sub, v_area, v_video, v_also, true);
      get diagnostics n = row_count;
      ex_upd := ex_upd + n;
    end if;
  end loop;

  -- any new category / subcategory pairs go to the end of the list
  insert into public.exercise_categories (category, subcategory, sort_order)
  select x.category, x.subcategory,
         (select coalesce(max(sort_order), 0) from public.exercise_categories) + row_number() over (order by x.category, x.subcategory)
  from (select distinct category, subcategory from public.exercises where subcategory is not null) x
  where not exists (select 1 from public.exercise_categories c where c.category = x.category and c.subcategory = x.subcategory);

  -- throwing drills
  for r in select * from jsonb_array_elements(coalesce(p_drills, '[]'::jsonb)) loop
    v_name := public._clean(r->>'name');
    continue when v_name is null;
    if lower(v_name) = any(seen_dr) then
      skipped := skipped || jsonb_build_object('tab', 'Throwing Drill Library', 'name', v_name, 'why', 'listed more than once; the first row was used');
      continue;
    end if;
    seen_dr := seen_dr || lower(v_name);
    v_type := initcap(coalesce(public._clean(r->>'drill_type'), ''));
    if v_type not in ('Stationary', 'Dynamic', 'Finisher', 'Athletic') then
      skipped := skipped || jsonb_build_object('tab', 'Throwing Drill Library', 'name', v_name,
        'why', 'Drill Type must be Stationary, Dynamic, Finisher or Athletic');
      continue;
    end if;
    v_reps  := public._clean(r->>'reps');
    v_balls := public._clean(r->>'ball_type');
    v_video := public._clean(r->>'video');
    v_also  := public._clean(r->>'also_fits');

    select id into v_id from public.throwing_drills where lower(name) = lower(v_name);
    if v_id is null then
      select id into v_id from public.throwing_drills d
      where exists (select 1 from unnest(d.old_names) o where lower(o) = lower(v_name)) limit 1;
    end if;
    if v_id is null then
      insert into public.throwing_drills (name, drill_type, reps, ball_type, video_url, also_fits)
      values (v_name, v_type, v_reps, v_balls, v_video, v_also);
      dr_add := dr_add + 1;
    else
      update public.throwing_drills d
         set name = v_name, drill_type = v_type, reps = v_reps, ball_type = v_balls,
             video_url = v_video, also_fits = v_also, active = true
       where d.id = v_id
         and (d.name, d.drill_type, d.reps, d.ball_type, d.video_url, d.also_fits, d.active)
             is distinct from (v_name, v_type, v_reps, v_balls, v_video, v_also, true);
      get diagnostics n = row_count;
      dr_upd := dr_upd + n;
    end if;
  end loop;

  select count(*) into v_app_only from public.exercises where active and not (lower(name) = any(seen_ex));

  insert into public.library_sync_log (ex_in_sheet, ex_added, ex_updated, drills_in_sheet, drills_added, drills_updated, app_only, skipped)
  values (cardinality(seen_ex), ex_add, ex_upd, cardinality(seen_dr), dr_add, dr_upd, v_app_only, skipped);

  v_result := jsonb_build_object('exercises_in_sheet', cardinality(seen_ex), 'exercises_added', ex_add, 'exercises_updated', ex_upd,
    'drills_in_sheet', cardinality(seen_dr), 'drills_added', dr_add, 'drills_updated', dr_upd,
    'only_in_app', v_app_only, 'skipped', skipped);
  return v_result;
end $$;
revoke execute on function public.sheet_sync_library(text, jsonb, jsonb) from public, authenticated;
grant execute on function public.sheet_sync_library(text, jsonb, jsonb) to anon;

-- =====================================================================
-- 2. Backup export. The script asks for the list of tables, then reads
--    each one in pages, so no single request runs long.
-- =====================================================================
create or replace function public.backup_tables(p_token text)
returns table (table_name text, row_count bigint)
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public._token_ok('coach_sheet', p_token) then raise exception 'Not allowed'; end if;
  for t in
    select c.relname::text from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and c.relname <> 'integration_tokens'
    order by 1
  loop
    table_name := t;
    execute format('select count(*) from public.%I', t) into row_count;
    return next;
  end loop;
end $$;
revoke execute on function public.backup_tables(text) from public, authenticated;
grant execute on function public.backup_tables(text) to anon;

create or replace function public.backup_page(p_token text, p_table text, p_offset int default 0, p_limit int default 2000)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._token_ok('coach_sheet', p_token) then raise exception 'Not allowed'; end if;
  if p_table = 'integration_tokens' or not exists (
       select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and c.relkind = 'r' and c.relname = p_table) then
    raise exception 'Unknown table %', p_table;
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select * from public.%I order by 1 offset %s limit %s) x',
                 p_table, greatest(p_offset, 0), least(greatest(p_limit, 1), 5000))
    into v;
  return v;
end $$;
revoke execute on function public.backup_page(text, text, int, int) from public, authenticated;
grant execute on function public.backup_page(text, text, int, int) to anon;

-- =====================================================================
-- 3. YouTube videos from @WrightStatePitching
-- =====================================================================
create table if not exists public.videos (
  id            uuid primary key default gen_random_uuid(),
  youtube_id    text not null unique,
  title         text not null,
  published_at  timestamptz,
  recorded_on   date,
  video_type    text,
  person_id     uuid references public.people(id),
  match_status  text not null default 'unmatched' check (match_status in ('auto', 'manual', 'unmatched', 'ignored')),
  match_note    text,
  privacy       text,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists videos_person on public.videos (person_id, recorded_on desc);
alter table public.videos enable row level security;
drop policy if exists "see own videos" on public.videos;
create policy "see own videos" on public.videos for select to authenticated
  using (public.is_coach() or (person_id = public.me() and match_status in ('auto', 'manual')));
drop policy if exists "coaches sort videos" on public.videos;
create policy "coaches sort videos" on public.videos for update to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());
grant select, update on public.videos to authenticated;

drop trigger if exists videos_history on public.videos;
create trigger videos_history after update of person_id, match_status, video_type, recorded_on on public.videos
  for each row execute function public.log_change();

-- words only: "Brody Papay - Bullpen 11/20" -> " brody papay bullpen 11 20 "
create or replace function public._words(t text) returns text
language sql immutable as $$
  select ' ' || btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g')) || ' '
$$;

-- Work out who / what / when from a video title
create or replace function public.read_video_title(p_title text, p_published timestamptz,
  out person_id uuid, out match_status text, out match_note text, out recorded_on date, out video_type text)
language plpgsql stable security definer set search_path = public as $$
declare
  w text := public._words(p_title);
  pub date := coalesce((p_published at time zone 'America/New_York')::date, current_date);
  m text[]; mo int; dy int; yr int; d date;
  best int; n int; names text;
  mon text[] := array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
begin
  -- who: score every active athlete; full name or alias beats last name alone
  with cand as (
    select p.id, p.first_name, p.last_name, p.is_pitcher,
      case
        when w like '%' || public._words(p.first_name || ' ' || p.last_name) || '%' then 3
        when exists (select 1 from unnest(p.aliases) a where length(a) > 2 and w like '%' || public._words(a) || '%') then 3
        when length(p.last_name) > 2 and w like '%' || public._words(p.last_name) || '%' then 2
        else 0 end as score
    from public.people p
    where p.active and not p.is_coach
  ), scored as (
    select *, case when is_pitcher then 1 else 0 end as pitch from cand where score > 0
  ), top as (
    select * from scored where score = (select max(score) from scored)
  ), top2 as (  -- same last name twice (the Gilkersons): prefer pitchers, it's a pitching channel
    select * from top where pitch = (select max(pitch) from top)
  )
  select (select max(score) from scored), (select count(*) from top2),
         (select string_agg(first_name || ' ' || last_name, ', ' order by last_name, first_name) from top),
         (select id from top2 limit 1)
    into best, n, names, person_id;

  if best is null then
    person_id := null; match_status := 'unmatched'; match_note := 'No athlete name found in the title';
  elsif n > 1 then
    person_id := null; match_status := 'unmatched'; match_note := 'Could be: ' || names;
  else
    match_status := 'auto'; match_note := null;
  end if;

  -- when: first real date in the title (11/20/26, 11-20, 11.20.2026, Nov 20), else the upload date
  recorded_on := null;
  for m in select regexp_matches(coalesce(p_title, ''), '(?<![\d.])(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?(?![\d.])', 'g') loop
    mo := m[1]::int; dy := m[2]::int;
    yr := case when m[3] is null then extract(year from pub)::int
               when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end;
    if mo between 1 and 12 and dy between 1 and 31 then
      begin
        d := make_date(yr, mo, dy);
        if m[3] is null and d > pub + 7 then d := make_date(yr - 1, mo, dy); end if;
        recorded_on := d; exit;
      exception when others then null;
      end;
    end if;
  end loop;
  if recorded_on is null then
    m := regexp_match(lower(coalesce(p_title, '')), '\m(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\M');
    if m is not null then
      begin
        d := make_date(extract(year from pub)::int, array_position(mon, m[1]), m[2]::int);
        if d > pub + 7 then d := d - interval '1 year'; end if;
        recorded_on := d;
      exception when others then null;
      end;
    end if;
  end if;
  recorded_on := coalesce(recorded_on, pub);

  -- what
  video_type := case
    when w ~ ' (live ab|live abs|live bp|live|lab) ' then 'Live'
    when w ~ ' (bullpen|bullpens|pen) ' then 'Bullpen'
    when w ~ ' (flat ground|flatground|flat) ' then 'Flat Ground'
    when w ~ ' (pull down|pulldown|pulldowns|pull downs) ' then 'Pulldown'
    when w ~ ' (scrimmage|intrasquad) ' then 'Scrimmage'
    when w ~ ' (game|outing|start) ' then 'Game'
    when w ~ ' (mechanics|drill|drills|catch play|long toss) ' then 'Drill Work'
    else null end;
end $$;
revoke execute on function public.read_video_title(text, timestamptz) from public, anon, authenticated;

-- Called by the YouTube script with the channel's latest uploads
create or replace function public.youtube_ingest(p_token text, p_videos jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; t record; v_new int := 0; v_changed int := 0; v_skipped int := 0; n int;
  v_ytid text; v_title text; v_pub timestamptz; v_priv text;
begin
  if not public._token_ok('youtube', p_token) then
    raise exception 'This script is not allowed to send videos. Check the token at the top of the script.';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_videos, '[]'::jsonb)) loop
    v_ytid  := public._clean(r->>'id');
    v_title := public._clean(r->>'title');
    v_priv  := lower(coalesce(public._clean(r->>'privacy'), 'unlisted'));
    begin v_pub := (r->>'published_at')::timestamptz; exception when others then v_pub := null; end;
    if v_ytid is null or v_title is null or v_priv = 'private' then v_skipped := v_skipped + 1; continue; end if;

    if not exists (select 1 from public.videos where youtube_id = v_ytid) then
      select * into t from public.read_video_title(v_title, v_pub);
      insert into public.videos (youtube_id, title, published_at, recorded_on, video_type, person_id, match_status, match_note, privacy)
      values (v_ytid, v_title, v_pub, t.recorded_on, t.video_type, t.person_id, t.match_status, t.match_note, v_priv);
      v_new := v_new + 1;
    else
      -- title fixed on YouTube? re-read it, unless a coach already sorted this video by hand
      update public.videos v set title = v_title, published_at = coalesce(v_pub, v.published_at), privacy = v_priv, updated_at = now()
       where v.youtube_id = v_ytid and (v.title, v.privacy) is distinct from (v_title, v_priv);
      get diagnostics n = row_count;
      if n > 0 then
        v_changed := v_changed + 1;
        select * into t from public.read_video_title(v_title, v_pub);
        update public.videos v set recorded_on = t.recorded_on, video_type = t.video_type,
               person_id = t.person_id, match_status = t.match_status, match_note = t.match_note
         where v.youtube_id = v_ytid and v.match_status in ('auto', 'unmatched');
      end if;
    end if;
  end loop;

  perform public._rematch_unmatched();
  return jsonb_build_object('new', v_new, 'retitled', v_changed, 'skipped', v_skipped,
    'waiting_for_a_coach', (select count(*) from public.videos where match_status = 'unmatched'));
end $$;
revoke execute on function public.youtube_ingest(text, jsonb) from public, authenticated;
grant execute on function public.youtube_ingest(text, jsonb) to anon;

-- Try the inbox again (e.g. after adding an athlete or an alias)
create or replace function public._rematch_unmatched() returns int
language plpgsql security definer set search_path = public as $$
declare v record; t record; n int := 0;
begin
  for v in select id, title, published_at from public.videos where match_status = 'unmatched' loop
    select * into t from public.read_video_title(v.title, v.published_at);
    if t.match_status = 'auto' then
      update public.videos set person_id = t.person_id, match_status = 'auto', match_note = null,
             video_type = coalesce(video_type, t.video_type), updated_at = now()
       where id = v.id;
      n := n + 1;
    elsif t.match_note is distinct from (select match_note from public.videos where id = v.id) then
      update public.videos set match_note = t.match_note where id = v.id;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public._rematch_unmatched() from public, anon, authenticated;

create or replace function public.rematch_videos() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.coach_can_edit() then raise exception 'Coaches only'; end if;
  return public._rematch_unmatched();
end $$;
revoke execute on function public.rematch_videos() from public, anon;
grant execute on function public.rematch_videos() to authenticated;

-- ---------------------------------------------------------------------
-- Last step: make the two script tokens. Copy each one into its script.
-- (Running this again makes new tokens and the old ones stop working.)
-- ---------------------------------------------------------------------
select * from public.issue_integration_tokens();
