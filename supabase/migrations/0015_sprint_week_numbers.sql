-- =====================================================================
-- The Raidergang — sprint weeks follow the calendar from Sep 14
--   • This week's 10/10s (week of Nov 23) are Fall Wk 11.
--   • Fall Wk 10 (Nov 16-20) was the off week: no times, no medals.
--   • Weeks with only app-logged times are named the same way
--     (next week = Fall Wk 12) through the end of December.
-- Run after 0014.
-- =====================================================================

update public.sprint_results set session_label = 'Fall Wk 11'
where session_label = 'Fall Wk 10' and run_date >= date '2026-11-23';

create or replace function public._sprint_sessions()
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
         coalesce(l.label, case when k.wk between date '2026-09-14' and date '2026-12-28'
                   then 'Fall Wk ' || ((k.wk - date '2026-09-14') / 7 + 1)
                   else 'Week of ' || to_char(k.wk, 'Mon FMDD') end),
         k.wk, k.is_pitcher, k.best, k.n::int, k.rk::int,
         case when k.n >= 4 and k.rk <= 3 then (array['gold', 'silver', 'bronze'])[k.rk] end,
         (k.wk + 7) <= public._sprint_today()
  from k join lbl l on l.sprint = k.sprint and l.wk = k.wk
$$;

notify pgrst, 'reload schema';
select session, session_date, case when final then 'final' else 'live now' end as status, count(*) as runners
from public._sprint_sessions() where session_date >= date '2026-11-02'
group by 1, 2, 3 order by 2 desc;
