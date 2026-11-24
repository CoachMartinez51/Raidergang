-- =====================================================================
-- The Raidergang — live sprint leaderboard, official medals on Sunday night
--
--   • Every time in the same Mon–Sun week (sheet or app) is one testing week,
--     so a time logged in the app can knock someone off the board.
--   • The current week is LIVE: standings move as times come in.
--   • When the week ends (midnight Sunday, Ohio time) it becomes FINAL and
--     its top 3 become the official medals in everyone's medal case.
--   • Fall Wk 10 (the 10/10s) is this week's testing, so it moves to the
--     week of Nov 23 to sit with the times being logged now.
-- Run after 0013.
-- =====================================================================

update public.sprint_results set run_date = date '2026-11-23'
where session_label = 'Fall Wk 10' and source = 'sheet' and run_date = date '2026-11-09';

drop function if exists public.sprint_spotlight();
drop function if exists public.sprint_board();
drop function if exists public.sprint_history(uuid);
drop function if exists public._sprint_sessions();

create or replace function public._sprint_today() returns date
language sql stable as $$ select (now() at time zone 'America/New_York')::date $$;

create function public._sprint_sessions()
returns table (person_id uuid, sprint text, session text, session_date date, is_pitcher boolean,
               best numeric, runners int, rk int, medal text, final boolean)
language sql stable security definer set search_path = public as $$
  with r as (
    select s.person_id, s.sprint, s.seconds, s.run_date, s.session_label, p.is_pitcher,
           date_trunc('week', s.run_date)::date as wk
    from public.sprint_results s
    join public.people p on p.id = s.person_id
    where s.retired_at is null and p.active and not p.is_coach
  ), lbl as (
    select sprint, wk, max(session_label) as label from r group by sprint, wk
  ), b as (
    select r.person_id, r.sprint, r.wk, r.is_pitcher, min(r.seconds) as best
    from r group by r.person_id, r.sprint, r.wk, r.is_pitcher
  ), k as (
    select b.*,
      dense_rank() over (partition by b.sprint, b.wk, b.is_pitcher order by b.best) as rk,
      count(*) over (partition by b.sprint, b.wk, b.is_pitcher) as n
    from b
  )
  select k.person_id, k.sprint,
         coalesce(l.label, 'Week of ' || to_char(k.wk, 'Mon FMDD')),
         k.wk, k.is_pitcher, k.best, k.n::int, k.rk::int,
         case when k.n >= 4 and k.rk <= 3 then (array['gold', 'silver', 'bronze'])[k.rk] end,
         (k.wk + 7) <= public._sprint_today()
  from k join lbl l on l.sprint = k.sprint and l.wk = k.wk
$$;
revoke execute on function public._sprint_sessions() from public, anon, authenticated;

create function public.sprint_history(p_person uuid)
returns table (sprint text, session text, session_date date, best numeric, runners int, medal text, final boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_person is distinct from public.me() and not public.is_coach() then
    raise exception 'You can only see your own sprint times';
  end if;
  return query
    select s.sprint, s.session, s.session_date, s.best, s.runners, s.medal, s.final
    from public._sprint_sessions() s
    where s.person_id = p_person
    order by s.session_date desc, s.sprint;
end $$;
revoke execute on function public.sprint_history(uuid) from public, anon;
grant execute on function public.sprint_history(uuid) to authenticated;

create function public.sprint_board()
returns table (person_id uuid, sprint text, session text, session_date date, is_pitcher boolean,
               best numeric, runners int, medal text, final boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_coach() then raise exception 'Coaches only'; end if;
  return query select s.person_id, s.sprint, s.session, s.session_date, s.is_pitcher, s.best, s.runners, s.medal, s.final
    from public._sprint_sessions() s order by 4 desc, 2, 6;
end $$;
revoke execute on function public.sprint_board() from public, anon;
grant execute on function public.sprint_board() to authenticated;

-- What the whole team sees:
--   status 'live'     = this week's top 3 so far (medals need 4+ runners), plus Most Improved so far
--   status 'official' = the last finished week that gave out medals, plus its Most Improved
create function public.sprint_spotlight()
returns table (status text, sprint text, session text, session_date date, is_pitcher boolean, person_id uuid,
               first_name text, last_name text, best numeric, rk int, runners int, medal text,
               prev_best numeric, improved_by numeric, most_improved boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.me() is null then raise exception 'Sign in first'; end if;
  return query
  with s as (select * from public._sprint_sessions()),
  official as (
    select x.sprint, x.session_date from s x where x.final
    group by x.sprint, x.session_date having bool_or(x.medal is not null)
    order by x.session_date desc limit 1
  ),
  live as (
    select x.sprint, x.session_date from s x where not x.final
    group by x.sprint, x.session_date
    order by x.session_date desc, count(*) desc limit 1
  ),
  picked as (
    select 'official'::text as st, o.sprint, o.session_date from official o
    union all select 'live', l.sprint, l.session_date from live l
  ),
  cur as (select p.st, x.* from s x join picked p on p.sprint = x.sprint and p.session_date = x.session_date),
  withprev as (
    select c.*,
      (select y.best from s y
        where y.person_id = c.person_id and y.sprint = c.sprint and y.session_date < c.session_date
        order by y.session_date desc limit 1) as pb
    from cur c
  ),
  scored as (
    select w.*, case when w.pb is not null and w.pb > w.best then w.pb - w.best end as imp from withprev w
  ),
  ranked as (
    select sc.*, (sc.imp is not null and sc.imp = max(sc.imp) over (partition by sc.st, sc.is_pitcher)) as mi from scored sc
  )
  select r.st, r.sprint, r.session, r.session_date, r.is_pitcher, r.person_id, p.first_name, p.last_name,
         r.best, r.rk, r.runners, r.medal, r.pb, r.imp, coalesce(r.mi, false)
  from ranked r join public.people p on p.id = r.person_id
  where r.rk <= 3 or r.mi
  order by r.st, r.is_pitcher desc, r.best;
end $$;
revoke execute on function public.sprint_spotlight() from public, anon;
grant execute on function public.sprint_spotlight() to authenticated;

notify pgrst, 'reload schema';
select sprint, session, case when final then 'final' else 'live now' end as status,
       count(*) as runners
from public._sprint_sessions() where session_date >= date '2026-11-02'
group by 1, 2, 3, session_date order by session_date desc;
