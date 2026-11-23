-- =====================================================================
-- The Raidergang — Sprint times (5/10, 10/10, 15/10, 20/10)
--   • Athletes log their own times (any number of reps; the best counts).
--   • Late is fine: any date since Aug 1, 2026 up to tomorrow.
--   • PR = an athlete's fastest time ever for that sprint.
--   • Medals are per testing week: fastest = gold, then silver, bronze.
--     Ties share a medal. Pitchers and position players are ranked
--     separately, and a week needs at least 4 runners to give medals.
--   • Nothing is deleted: a wrong entry is "removed" (retired_at set).
-- Safe to re-run.
-- =====================================================================

create table if not exists public.sprint_results (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references public.people(id),
  sprint        text not null check (sprint in ('5/10', '10/10', '15/10', '20/10')),
  run_date      date not null,
  session_label text,               -- e.g. 'Fall Wk 9' for times brought over from the sheet
  seconds       numeric(4, 2) not null check (seconds between 0.70 and 2.50),
  source        text not null default 'app' check (source in ('app', 'coach', 'sheet')),
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid
);
create index if not exists sprint_results_person on public.sprint_results (person_id, sprint);
create index if not exists sprint_results_session on public.sprint_results (sprint, run_date);

drop trigger if exists sprint_results_history on public.sprint_results;
create trigger sprint_results_history after insert or update or delete on public.sprint_results
  for each row execute function public.log_change();
drop trigger if exists sprint_results_stamp on public.sprint_results;
create trigger sprint_results_stamp before insert on public.sprint_results
  for each row execute function public.stamp_created_by();

alter table public.sprint_results enable row level security;

drop policy if exists "own or coach read" on public.sprint_results;
create policy "own or coach read" on public.sprint_results for select to authenticated
  using (person_id = public.me() or public.is_coach());

drop policy if exists "log own sprints" on public.sprint_results;
create policy "log own sprints" on public.sprint_results for insert to authenticated
  with check (
    person_id = public.me() and source = 'app' and session_label is null and retired_at is null
    and run_date between date '2026-08-01' and current_date + 1
  );

drop policy if exists "fix own sprints" on public.sprint_results;
create policy "fix own sprints" on public.sprint_results for update to authenticated
  using (person_id = public.me() and source = 'app')
  with check (person_id = public.me() and source = 'app' and session_label is null
              and run_date between date '2026-08-01' and current_date + 1);

drop policy if exists "editors manage sprints" on public.sprint_results;
create policy "editors manage sprints" on public.sprint_results for all to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());

grant select, insert, update on public.sprint_results to authenticated;

-- ---------------------------------------------------------------------
-- Best time per athlete per testing week, with medals.
-- Internal: the two functions below decide who may see which rows.
-- ---------------------------------------------------------------------
create or replace function public._sprint_sessions()
returns table (person_id uuid, sprint text, session text, session_date date, is_pitcher boolean,
               best numeric, runners int, medal text)
language sql stable security definer set search_path = public as $$
  with r as (
    select s.person_id, s.sprint, s.seconds, s.run_date, p.is_pitcher,
           coalesce(s.session_label, 'Week of ' || to_char(date_trunc('week', s.run_date)::date, 'Mon FMDD')) as session,
           coalesce(s.session_label, to_char(date_trunc('week', s.run_date)::date, 'YYYY-MM-DD')) as session_key
    from public.sprint_results s
    join public.people p on p.id = s.person_id
    where s.retired_at is null and p.active and not p.is_coach
  ), b as (
    select person_id, sprint, session, session_key, is_pitcher, min(seconds) as best,
           min(run_date) as session_date
    from r group by person_id, sprint, session, session_key, is_pitcher
  ), k as (
    select b.*,
      dense_rank() over (partition by sprint, session_key, is_pitcher order by best) as rk,
      count(*) over (partition by sprint, session_key, is_pitcher) as n
    from b
  )
  select person_id, sprint, session, session_date, is_pitcher, best, n::int,
         case when n >= 4 then (array['gold', 'silver', 'bronze'])[rk] end
  from k
$$;
revoke execute on function public._sprint_sessions() from public, anon, authenticated;

-- One athlete's history (their own, or anyone's for a coach)
create or replace function public.sprint_history(p_person uuid)
returns table (sprint text, session text, session_date date, best numeric, runners int, medal text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_person is distinct from public.me() and not public.is_coach() then
    raise exception 'You can only see your own sprint times';
  end if;
  return query
    select s.sprint, s.session, s.session_date, s.best, s.runners, s.medal
    from public._sprint_sessions() s
    where s.person_id = p_person
    order by s.session_date desc, s.sprint;
end $$;
revoke execute on function public.sprint_history(uuid) from public, anon;
grant execute on function public.sprint_history(uuid) to authenticated;

-- The whole team, coaches only
create or replace function public.sprint_board()
returns table (person_id uuid, sprint text, session text, session_date date, is_pitcher boolean,
               best numeric, runners int, medal text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_coach() then raise exception 'Coaches only'; end if;
  return query select * from public._sprint_sessions() order by 4 desc, 2, 6;
end $$;
revoke execute on function public.sprint_board() from public, anon;
grant execute on function public.sprint_board() to authenticated;
