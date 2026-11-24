-- =====================================================================
-- The Raidergang — throwing day check-off + how it felt
--   Athletes tick off their throw and add notes; coaches see them all.
--   Append-only: saving again adds a new row, the latest one counts.
-- Run after 0015.
-- =====================================================================

create table if not exists public.throw_logs (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people(id),
  day         date not null,
  program_id  uuid references public.throw_programs(id),
  title       text check (length(title) <= 160),       -- what was prescribed that day (copy)
  done        boolean not null default true,
  feel        text check (length(feel) <= 1000),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.people(id)
);
create index if not exists throw_logs_person_day on public.throw_logs (person_id, day desc);
create index if not exists throw_logs_day on public.throw_logs (day desc);

drop trigger if exists throw_logs_stamp on public.throw_logs;
create trigger throw_logs_stamp before insert on public.throw_logs for each row execute function public.stamp_created_by();

alter table public.throw_logs enable row level security;
revoke all on public.throw_logs from anon;
grant select, insert on public.throw_logs to authenticated;

drop policy if exists "own throw logs" on public.throw_logs;
create policy "own throw logs" on public.throw_logs for select to authenticated
  using (person_id = public.me() or public.is_coach());
drop policy if exists "log own throw" on public.throw_logs;
create policy "log own throw" on public.throw_logs for insert to authenticated
  with check (
    (person_id = public.me() and day between (now() at time zone 'America/New_York')::date - 14
                                         and (now() at time zone 'America/New_York')::date + 1)
    or public.coach_can_edit()
  );

create or replace view public.current_throw_logs with (security_invoker = true) as
  select distinct on (person_id, day) * from public.throw_logs order by person_id, day, created_at desc;
grant select on public.current_throw_logs to authenticated;

notify pgrst, 'reload schema';
select 'Throw logs ready' as done;
