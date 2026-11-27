-- =====================================================================
-- The Raidergang — athletes can log or fix lifts from the last 7 days
-- (was 3).
-- =====================================================================
drop policy if exists "log own sets" on public.set_logs;
create policy "log own sets" on public.set_logs for insert to authenticated
  with check (
    person_id = public.me()
    and log_date between (now() at time zone 'America/New_York')::date - 7
                     and (now() at time zone 'America/New_York')::date + 1
  );
select 'Athletes can now log the last 7 days' as done;
