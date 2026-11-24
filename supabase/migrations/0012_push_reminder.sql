-- =====================================================================
-- The Raidergang — 11 AM check-in reminder (push notifications)
--
-- How it works:
--   • An athlete taps "Turn on" in the app (from the Home Screen app on iPhone).
--     Their phone gives us a push address, saved in push_subscriptions.
--   • Every day at 11:00 AM Eastern, pg_cron calls the "checkin-reminder"
--     Edge Function. It asks push_targets() who hasn't checked in (or has no
--     weight yet) today and sends each of them one notification.
--   • The function and the database share a private run token that lives
--     only in push_config (no one can read that table from the app).
--   • The function makes its own push keys the first time it runs, so no
--     secret ever needs to be copied anywhere.
-- Run after 0011. Deploy the Edge Function first (see the setup steps).
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- One row per phone (an athlete can have more than one device).
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people(id) on delete cascade,
  endpoint     text not null unique check (endpoint like 'https://%'),
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists push_subscriptions_person on public.push_subscriptions (person_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
drop policy if exists "see own push" on public.push_subscriptions;
create policy "see own push" on public.push_subscriptions for select to authenticated
  using (person_id = public.me());
drop policy if exists "remove own push" on public.push_subscriptions;
create policy "remove own push" on public.push_subscriptions for delete to authenticated
  using (person_id = public.me());

-- Private settings: push keys and the run token. No grants at all.
create table if not exists public.push_config (
  id            int primary key default 1 check (id = 1),
  vapid_public  text,
  vapid_private text,
  run_token     text not null,
  function_url  text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from public, anon, authenticated;
insert into public.push_config (id, run_token, function_url)
values (1, encode(extensions.gen_random_bytes(24), 'hex'),
        'https://fjrcbjwpmapetbcqfbwm.supabase.co/functions/v1/checkin-reminder')
on conflict (id) do nothing;

-- One reminder per athlete per day, even if the job runs twice.
create table if not exists public.push_log (
  person_id uuid not null references public.people(id) on delete cascade,
  day       date not null,
  kind      text not null,
  sent_at   timestamptz not null default now(),
  primary key (person_id, day, kind)
);
alter table public.push_log enable row level security;
revoke all on public.push_log from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- App side
-- ---------------------------------------------------------------------
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select vapid_public from public.push_config where id = 1 and public.me() is not null
$$;
revoke execute on function public.push_public_key() from public, anon;
grant execute on function public.push_public_key() to authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.me() is null then raise exception 'Sign in first.'; end if;
  insert into public.push_subscriptions (person_id, endpoint, p256dh, auth, user_agent)
  values (public.me(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set person_id = excluded.person_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Internal: ask the Edge Function to run. Only the database can call this.
create or replace function public._push_run(p_mode text, p_person uuid default null) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare c public.push_config;
begin
  select * into c from public.push_config where id = 1;
  return net.http_post(
    url := c.function_url,
    body := jsonb_build_object('token', c.run_token, 'mode', p_mode, 'person_id', p_person),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000);
end $$;
revoke execute on function public._push_run(text, uuid) from public, anon, authenticated;

-- "Send me a test" button in the app (only to the person pressing it).
create or replace function public.send_me_test_push() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.me() is null then raise exception 'Sign in first.'; end if;
  if not exists (select 1 from public.push_subscriptions where person_id = public.me()) then
    raise exception 'Reminders are not turned on for this phone yet.';
  end if;
  perform public._push_run('test', public.me());
end $$;
revoke execute on function public.send_me_test_push() from public, anon;
grant execute on function public.send_me_test_push() to authenticated;

-- Coaches: how many athletes have reminders on.
create or replace function public.push_status()
returns table (athletes int, with_reminders int)
language sql stable security definer set search_path = public as $$
  select count(*)::int,
         count(*) filter (where exists (select 1 from public.push_subscriptions s where s.person_id = p.id))::int
  from public.people p
  where public.is_coach() and p.active and not p.is_coach
$$;
revoke execute on function public.push_status() from public, anon;
grant execute on function public.push_status() to authenticated;

-- ---------------------------------------------------------------------
-- Edge Function side (needs the run token)
-- ---------------------------------------------------------------------
create or replace function public.push_targets(p_token text, p_mode text, p_person uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.push_config; today date := (now() at time zone 'America/New_York')::date; out jsonb;
begin
  select * into c from public.push_config where id = 1;
  if c.run_token is distinct from p_token then raise exception 'Not allowed.'; end if;

  if p_mode = 'test' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
             'title', 'Raidergang', 'body', 'Reminders are on, ' || p.first_name || '. You''ll hear from us at 11 if you haven''t checked in.')), '[]')
      into out
    from public.push_subscriptions s join public.people p on p.id = s.person_id
    where s.person_id = p_person;

  elsif p_mode = 'daily' then
    with due as (
      select p.id, p.first_name, (c2.id is null) as no_checkin
      from public.people p
      left join public.current_checkins c2 on c2.person_id = p.id and c2.checkin_date = today
      where p.active and not p.is_coach
        and (c2.id is null or c2.bodyweight is null)
        and exists (select 1 from public.push_subscriptions s where s.person_id = p.id)
    ), fresh as (
      insert into public.push_log (person_id, day, kind)
      select id, today, 'checkin' from due
      on conflict do nothing
      returning person_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
             'title', 'Check in, ' || d.first_name,
             'body', case when d.no_checkin then 'Log your weight and RPE for today. Takes 20 seconds.'
                          else 'Add your weight for today.' end)), '[]')
      into out
    from due d join fresh f on f.person_id = d.id
    join public.push_subscriptions s on s.person_id = d.id;
    update public.push_subscriptions s set last_sent_at = now()
    where s.person_id in (select person_id from public.push_log where day = today and kind = 'checkin' and sent_at > now() - interval '1 minute');

  else
    out := '[]'::jsonb;  -- 'init': just hand back the keys
  end if;

  return jsonb_build_object('vapid_public', c.vapid_public, 'vapid_private', c.vapid_private, 'targets', out);
end $$;
revoke execute on function public.push_targets(text, text, uuid) from public, authenticated;
grant execute on function public.push_targets(text, text, uuid) to anon;

create or replace function public.push_save_keys(p_token text, p_public text, p_private text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select run_token from public.push_config where id = 1) is distinct from p_token then raise exception 'Not allowed.'; end if;
  update public.push_config set vapid_public = p_public, vapid_private = p_private
  where id = 1 and vapid_public is null;
end $$;
revoke execute on function public.push_save_keys(text, text, text) from public, authenticated;
grant execute on function public.push_save_keys(text, text, text) to anon;

create or replace function public.push_forget(p_token text, p_endpoints text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if (select run_token from public.push_config where id = 1) is distinct from p_token then raise exception 'Not allowed.'; end if;
  delete from public.push_subscriptions where endpoint = any(p_endpoints);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.push_forget(text, text[]) from public, authenticated;
grant execute on function public.push_forget(text, text[]) to anon;

-- ---------------------------------------------------------------------
-- Schedule: cron runs in UTC, so fire at 15:00 and 16:00 UTC and only
-- go ahead when it is the 11 o'clock hour in Ohio (handles daylight saving).
-- ---------------------------------------------------------------------
create or replace function public.push_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  if extract(hour from now() at time zone 'America/New_York') = 11 then
    perform public._push_run('daily');
  end if;
end $$;
revoke execute on function public.push_daily() from public, anon, authenticated;

select cron.schedule('raidergang-checkin-reminder', '0 15,16 * * *', 'select public.push_daily()');

-- Wake the function once so it makes its push keys.
select public._push_run('init');

notify pgrst, 'reload schema';
select 'Reminder set for 11:00 AM' as done;
