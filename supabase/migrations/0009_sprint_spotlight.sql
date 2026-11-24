-- =====================================================================
-- The Raidergang — "The Medalists" + Most Improved (everyone can see)
-- For the most recent testing week that gave out medals:
--   • gold / silver / bronze (pitchers and position players separately)
--   • Most Improved: the biggest drop from each athlete's previous time
--     on that same sprint (ties share; only real improvements count)
-- Only medalists' and Most Improved names and times are shared.
-- Safe to re-run.
-- =====================================================================
create or replace function public.sprint_spotlight()
returns table (sprint text, session text, session_date date, is_pitcher boolean, person_id uuid,
               first_name text, last_name text, best numeric, medal text, prev_best numeric,
               improved_by numeric, most_improved boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.me() is null then raise exception 'Sign in first'; end if;
  return query
  with s as (select * from public._sprint_sessions()),
  pick as (
    select x.sprint, x.session from s x
    group by x.sprint, x.session
    having bool_or(x.medal is not null)
    order by max(x.session_date) desc
    limit 1
  ),
  cur as (select x.* from s x join pick p on p.sprint = x.sprint and p.session = x.session),
  withprev as (
    select c.*,
      (select y.best from s y
        where y.person_id = c.person_id and y.sprint = c.sprint and y.session <> c.session and y.session_date < c.session_date
        order by y.session_date desc limit 1) as pb
    from cur c
  ),
  scored as (
    select w.*, case when w.pb is not null and w.pb > w.best then w.pb - w.best end as imp
    from withprev w
  ),
  ranked as (
    select sc.*, (sc.imp is not null and sc.imp = max(sc.imp) over (partition by sc.is_pitcher)) as mi
    from scored sc
  )
  select r.sprint, r.session, r.session_date, r.is_pitcher, r.person_id, p.first_name, p.last_name,
         r.best, r.medal, r.pb, r.imp, coalesce(r.mi, false)
  from ranked r join public.people p on p.id = r.person_id
  where r.medal is not null or r.mi
  order by r.is_pitcher desc, r.best;
end $$;
revoke execute on function public.sprint_spotlight() from public, anon;
grant execute on function public.sprint_spotlight() to authenticated;
