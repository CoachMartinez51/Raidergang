-- =====================================================================
-- The Raidergang — Throwing programs (Catch Play)
--
--   throw_programs     a named program, e.g. "Track A"
--   throw_days         one row per date in a program: day type, title,
--                      distance, catch play, plyos (none / half / full), note
--   throw_assignments  which program each pitcher is on (history kept)
--   people.throw_velo  the pitcher's average fall fastball (mph); the app
--                      turns it into Low / Medium / High mph ranges
-- Run after 0012.
-- =====================================================================

alter table public.people add column if not exists throw_velo numeric(4,1)
  check (throw_velo is null or throw_velo between 50 and 105);

create table if not exists public.throw_programs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(name) between 1 and 60),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.people(id)
);

create table if not exists public.throw_days (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.throw_programs(id) on delete cascade,
  day         date not null,
  kind        text not null check (kind in ('Off', 'Low', 'Medium', 'High', 'Bullpen', 'Live', 'Game', 'Recovery')),
  title       text not null check (length(title) <= 160),
  sp_title    text check (length(sp_title) <= 160),   -- starters' version when it differs (live days)
  distance    text check (length(distance) <= 40),
  catch_play  text check (length(catch_play) <= 60),
  plyos       text not null default 'none' check (plyos in ('none', 'half', 'full')),
  note        text check (length(note) <= 500),
  updated_at  timestamptz not null default now(),
  unique (program_id, day)
);
create index if not exists throw_days_program_day on public.throw_days (program_id, day);

create table if not exists public.throw_assignments (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people(id),
  program_id  uuid not null references public.throw_programs(id),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.people(id),
  retired_at  timestamptz
);
create unique index if not exists throw_assignments_current on public.throw_assignments (person_id) where retired_at is null;

drop trigger if exists throw_days_history on public.throw_days;
create trigger throw_days_history after insert or update or delete on public.throw_days
  for each row execute function public.log_change();
drop trigger if exists throw_assignments_history on public.throw_assignments;
create trigger throw_assignments_history after insert or update or delete on public.throw_assignments
  for each row execute function public.log_change();
drop trigger if exists throw_programs_stamp on public.throw_programs;
create trigger throw_programs_stamp before insert on public.throw_programs
  for each row execute function public.stamp_created_by();
drop trigger if exists throw_assignments_stamp on public.throw_assignments;
create trigger throw_assignments_stamp before insert on public.throw_assignments
  for each row execute function public.stamp_created_by();

alter table public.throw_programs enable row level security;
alter table public.throw_days enable row level security;
alter table public.throw_assignments enable row level security;

drop policy if exists "read programs" on public.throw_programs;
create policy "read programs" on public.throw_programs for select to authenticated using (public.me() is not null);
drop policy if exists "editors programs" on public.throw_programs;
create policy "editors programs" on public.throw_programs for all to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());

drop policy if exists "read days" on public.throw_days;
create policy "read days" on public.throw_days for select to authenticated using (public.me() is not null);
drop policy if exists "editors days" on public.throw_days;
create policy "editors days" on public.throw_days for all to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());

drop policy if exists "read own assignment" on public.throw_assignments;
create policy "read own assignment" on public.throw_assignments for select to authenticated
  using (person_id = public.me() or public.is_coach());
drop policy if exists "editors assign" on public.throw_assignments;
create policy "editors assign" on public.throw_assignments for insert to authenticated with check (public.coach_can_edit());
drop policy if exists "editors retire assignment" on public.throw_assignments;
create policy "editors retire assignment" on public.throw_assignments for update to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());

grant select, insert, update, delete on public.throw_programs, public.throw_days to authenticated;
grant select, insert, update on public.throw_assignments to authenticated;

-- One call to move a pitcher to a program (or take them off with null).
create or replace function public.set_throw_program(p_person uuid, p_program uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update public.throw_assignments set retired_at = now()
  where person_id = p_person and retired_at is null and program_id is distinct from p_program;
  if p_program is not null and not exists (
    select 1 from public.throw_assignments where person_id = p_person and program_id = p_program and retired_at is null
  ) then
    insert into public.throw_assignments (person_id, program_id) values (p_person, p_program);
  end if;
end $$;
revoke execute on function public.set_throw_program(uuid, uuid) from public, anon;
grant execute on function public.set_throw_program(uuid, uuid) to authenticated;

-- Copy a whole program under a new name (for "Track A → Custom for one pitcher").
create or replace function public.copy_throw_program(p_from uuid, p_name text) returns uuid
language plpgsql security invoker set search_path = public as $$
declare new_id uuid;
begin
  insert into public.throw_programs (name) values (p_name) returning id into new_id;
  insert into public.throw_days (program_id, day, kind, title, sp_title, distance, catch_play, plyos, note)
  select new_id, day, kind, title, sp_title, distance, catch_play, plyos, note from public.throw_days where program_id = p_from;
  return new_id;
end $$;
revoke execute on function public.copy_throw_program(uuid, text) from public, anon;
grant execute on function public.copy_throw_program(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Winter Arm Build-Up, Track A and Track B (Oct 26, 2026 → Opening Day)
-- Day types from the Coaching Database "Throwing" tab: long toss up to
-- 120 ft = Low, 120–220 ft = Medium, over 220 ft = High.
-- ---------------------------------------------------------------------
insert into public.throw_programs (name) values ('Track A'), ('Track B') on conflict (name) do nothing;

insert into public.throw_days (program_id, day, kind, title, sp_title, distance, catch_play, plyos, note)
select p.id, v.day::date, v.kind, v.title, v.sp_title, v.distance, v.catch_play, v.plyos, v.note
from (values
  ('Track A', '2026-10-26', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-10-27', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-10-28', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-10-29', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-10-30', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-10-31', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-11-01', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-11-02', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-11-03', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-11-04', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-11-05', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-11-06', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-11-07', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-11-08', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track A', '2026-11-09', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track A', '2026-11-10', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track A', '2026-11-11', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track A', '2026-11-12', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track A', '2026-11-13', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track A', '2026-11-14', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track A', '2026-11-15', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track A', '2026-11-16', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track A', '2026-11-17', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track A', '2026-11-18', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track A', '2026-11-19', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track A', '2026-11-20', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track A', '2026-11-21', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track A', '2026-11-22', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track A', '2026-11-23', 'Low', 'Long toss ~65 ft', null, '~65 ft', '10–20 min', 'half', 'Stretch-out long toss, building toward this week''s peak of ~90 ft.'),
  ('Track A', '2026-11-24', 'Low', 'Long toss ~75 ft', null, '~75 ft', '10–20 min', 'half', 'Stretch-out long toss, building toward this week''s peak of ~90 ft.'),
  ('Track A', '2026-11-25', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track A', '2026-11-26', 'Off', 'Off — Thanksgiving', null, null, null, 'none', 'Holiday — no throwing.'),
  ('Track A', '2026-11-27', 'Low', 'Long toss ~90 ft (peak)', null, '~90 ft', '10–20 min', 'half', 'Week''s peak distance. Pull down ~10 ft/throw back to 60 ft after.'),
  ('Track A', '2026-11-28', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track A', '2026-11-29', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track A', '2026-11-30', 'Medium', 'Long toss ~105 ft', null, '~105 ft', '20–30 min', 'full', 'Stretch-out long toss, building toward this week''s peak of ~150 ft.'),
  ('Track A', '2026-12-01', 'Medium', 'Long toss ~130 ft', null, '~130 ft', '20–30 min', 'full', 'Stretch-out long toss, building toward this week''s peak of ~150 ft.'),
  ('Track A', '2026-12-02', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track A', '2026-12-03', 'Medium', 'Long toss ~140 ft', null, '~140 ft', '20–30 min', 'full', 'Stretch-out long toss, near this week''s peak of ~150 ft.'),
  ('Track A', '2026-12-04', 'Medium', 'Long toss ~150 ft (peak)', null, '~150 ft', '20–30 min', 'full', 'Week''s peak distance. Pull down ~10 ft/throw back to 60 ft after.'),
  ('Track A', '2026-12-05', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track A', '2026-12-06', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track A', '2026-12-07', 'High', 'Long toss ~160 ft', null, '~160 ft', '20–30 min (10 min max distance)', 'full', 'Stretch-out long toss, building toward this week''s peak of ~230 ft.'),
  ('Track A', '2026-12-08', 'High', 'Long toss ~195 ft', null, '~195 ft', '20–30 min (10 min max distance)', 'full', 'Stretch-out long toss, building toward this week''s peak of ~230 ft.'),
  ('Track A', '2026-12-09', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track A', '2026-12-10', 'High', 'Long toss ~220 ft', null, '~220 ft', '20–30 min (10 min max distance)', 'full', 'Stretch-out long toss, near this week''s peak of ~230 ft.'),
  ('Track A', '2026-12-11', 'High', 'Long toss ~230 ft (peak)', null, '~230 ft', '20–30 min (10 min max distance)', 'full', 'Week''s peak distance. Pull down ~10 ft/throw back to 60 ft after.'),
  ('Track A', '2026-12-12', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track A', '2026-12-13', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track A', '2026-12-14', 'Medium', 'Flat ground — changeups', null, null, '20–30 min', 'full', '10-15 changeups off flat ground + light catch.'),
  ('Track A', '2026-12-15', 'Medium', 'Long toss ~200 ft', null, '~200 ft', '20–30 min', 'full', 'Maintenance long toss, moderate intent.'),
  ('Track A', '2026-12-16', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2026-12-17', 'Bullpen', 'Bullpen #1 — 15-20 pitches', null, null, 'Catch play to comfort', 'full', 'Local/turf access: first mound pen, ~75% intent. Home access: continue flat ground instead.'),
  ('Track A', '2026-12-18', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track A', '2026-12-19', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2026-12-20', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2026-12-21', 'Medium', 'Flat ground — breaking balls', null, null, '20–30 min', 'full', '~10 breaking balls off flat ground + changeups.'),
  ('Track A', '2026-12-22', 'Medium', 'Long toss ~200-220 ft', null, '~200-220 ft', '20–30 min', 'full', 'Maintenance long toss, moderate-high intent.'),
  ('Track A', '2026-12-23', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2026-12-24', 'Bullpen', 'Bullpen #2 — 20-25 pitches', null, null, 'Catch play to comfort', 'full', '~80% intent, mix in secondary. Christmas Eve — keep the session short and flexible around family plans. Home access: flat ground continues.'),
  ('Track A', '2026-12-25', 'Off', 'Off — Christmas Day', null, null, null, 'none', 'Holiday — no throwing.'),
  ('Track A', '2026-12-26', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent (shifted from Fri where a holiday lands on it).'),
  ('Track A', '2026-12-27', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2026-12-28', 'Bullpen', 'Bullpen — 25 pitches', null, null, 'Catch play to comfort', 'full', '~85% intent, full mix.'),
  ('Track A', '2026-12-29', 'Medium', 'Long toss / flat recovery', null, '~180 ft', '20–30 min', 'full', 'Easy long toss to ~180 ft, arm care emphasis.'),
  ('Track A', '2026-12-30', 'Bullpen', 'Bullpen — 30 pitches', null, null, 'Catch play to comfort', 'full', '~85-90% intent, full mix, command focus.'),
  ('Track A', '2026-12-31', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Keep it short — New Year''s Eve.'),
  ('Track A', '2027-01-01', 'Off', 'Off — New Year''s Day', null, null, null, 'none', 'Holiday — no throwing.'),
  ('Track A', '2027-01-02', 'Bullpen', 'Bullpen — 35 pitches', null, null, 'Catch play to comfort', 'full', 'Final build pen before reconvening — ~90% intent, full mix.'),
  ('Track A', '2027-01-03', 'Off', 'Off', null, null, null, 'none', 'Travel/rest day before team reconvenes Monday.'),
  ('Track A', '2027-01-04', 'Bullpen', 'Bullpen — 30 pitches', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track A', '2027-01-05', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track A', '2027-01-06', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track A', '2027-01-07', 'Live', 'RP: LIVE — 25-30 pitches · 1-2 innings · 1 break', 'SP: LIVE — 25-30 pitches · 1-2 innings · 1 break', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track A', '2027-01-08', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track A', '2027-01-09', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track A', '2027-01-10', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2027-01-11', 'Bullpen', 'Bullpen — 30 pitches', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track A', '2027-01-12', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track A', '2027-01-13', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track A', '2027-01-14', 'Live', 'RP: LIVE — 35-40 pitches · 2 innings · 1 break', 'SP: LIVE — 35-40 pitches · 2 innings · 1 break', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track A', '2027-01-15', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track A', '2027-01-16', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track A', '2027-01-17', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2027-01-18', 'Bullpen', 'Bullpen — 30-35 pitches', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track A', '2027-01-19', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track A', '2027-01-20', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track A', '2027-01-21', 'Live', 'RP: LIVE — 40-45 pitches · 2-3 innings · 1-2 breaks', 'SP: LIVE — 40-45 pitches · 2-3 innings · 1-2 breaks', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track A', '2027-01-22', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track A', '2027-01-23', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track A', '2027-01-24', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2027-01-25', 'Bullpen', 'Bullpen — 30-35 pitches', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track A', '2027-01-26', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track A', '2027-01-27', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track A', '2027-01-28', 'Live', 'RP: LIVE — 50-55 pitches · 3 innings · 2 breaks (role ceiling)', 'SP: LIVE — 50-55 pitches · 3 innings · 2 breaks', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track A', '2027-01-29', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track A', '2027-01-30', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track A', '2027-01-31', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2027-02-01', 'Bullpen', 'Bullpen — 25-30 pitches (lighter)', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track A', '2027-02-02', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track A', '2027-02-03', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track A', '2027-02-04', 'Live', 'RP: LIVE — hold 55-60 pitches · 3 innings · 2 breaks (maintenance)', 'SP: LIVE — PEAK 65-75 pitches · 4-5 innings · 2 breaks', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track A', '2027-02-05', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track A', '2027-02-06', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track A', '2027-02-07', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track A', '2027-02-08', 'Bullpen', 'Optional tune-up bullpen — 15-20 pitches', null, null, 'Catch play to comfort', 'full', 'Only if a starter needs one final rep. Otherwise off.'),
  ('Track A', '2027-02-09', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit only.'),
  ('Track A', '2027-02-10', 'Low', 'Light catch play / flat ground', null, null, '10–20 min', 'half', 'Easy, no intent.'),
  ('Track A', '2027-02-11', 'Off', 'Off — mental prep', null, null, null, 'none', 'Optional very light flat catch only.'),
  ('Track A', '2027-02-12', 'Game', 'OPENING DAY — Game 1', null, null, 'Catch play to comfort', 'half', 'First game of the season.'),
  ('Track B', '2026-10-26', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'No bullpens or live work — easy catch, decompression.'),
  ('Track B', '2026-10-27', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2026-10-28', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'No bullpens or live work — easy catch, decompression.'),
  ('Track B', '2026-10-29', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2026-10-30', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'No bullpens or live work — easy catch, decompression.'),
  ('Track B', '2026-10-31', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2026-11-01', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2026-11-02', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-03', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-04', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-05', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-06', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-07', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-08', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-09', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-10', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-11', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-12', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-13', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-14', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-15', 'Off', 'Off — full rest', null, null, null, 'none', 'No throwing of any kind, including casual catch.'),
  ('Track B', '2026-11-16', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track B', '2026-11-17', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track B', '2026-11-18', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track B', '2026-11-19', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track B', '2026-11-20', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track B', '2026-11-21', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track B', '2026-11-22', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track B', '2026-11-23', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track B', '2026-11-24', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track B', '2026-11-25', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track B', '2026-11-26', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track B', '2026-11-27', 'Low', 'Light catch play', null, null, '15–20 min', 'half', '15-20 min flat-ground catch, no intent.'),
  ('Track B', '2026-11-28', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track B', '2026-11-29', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing.'),
  ('Track B', '2026-11-30', 'Medium', 'Long toss ~105 ft', null, '~105 ft', '20–30 min', 'full', 'Stretch-out long toss, building toward this week''s peak of ~150 ft.'),
  ('Track B', '2026-12-01', 'Medium', 'Long toss ~130 ft', null, '~130 ft', '20–30 min', 'full', 'Stretch-out long toss, building toward this week''s peak of ~150 ft.'),
  ('Track B', '2026-12-02', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track B', '2026-12-03', 'Medium', 'Long toss ~140 ft', null, '~140 ft', '20–30 min', 'full', 'Stretch-out long toss, near this week''s peak of ~150 ft.'),
  ('Track B', '2026-12-04', 'Medium', 'Long toss ~150 ft (peak)', null, '~150 ft', '20–30 min', 'full', 'Week''s peak distance. Pull down ~10 ft/throw back to 60 ft after.'),
  ('Track B', '2026-12-05', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track B', '2026-12-06', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track B', '2026-12-07', 'High', 'Long toss ~160 ft', null, '~160 ft', '20–30 min (10 min max distance)', 'full', 'Stretch-out long toss, building toward this week''s peak of ~230 ft.'),
  ('Track B', '2026-12-08', 'High', 'Long toss ~195 ft', null, '~195 ft', '20–30 min (10 min max distance)', 'full', 'Stretch-out long toss, building toward this week''s peak of ~230 ft.'),
  ('Track B', '2026-12-09', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track B', '2026-12-10', 'High', 'Long toss ~220 ft', null, '~220 ft', '20–30 min (10 min max distance)', 'full', 'Stretch-out long toss, near this week''s peak of ~230 ft.'),
  ('Track B', '2026-12-11', 'High', 'Long toss ~230 ft (peak)', null, '~230 ft', '20–30 min (10 min max distance)', 'full', 'Week''s peak distance. Pull down ~10 ft/throw back to 60 ft after.'),
  ('Track B', '2026-12-12', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track B', '2026-12-13', 'Off', 'Off', null, null, null, 'none', 'Full rest — no throwing, including casual catch.'),
  ('Track B', '2026-12-14', 'Medium', 'Flat ground — changeups', null, null, '20–30 min', 'full', '10-15 changeups off flat ground + light catch.'),
  ('Track B', '2026-12-15', 'Medium', 'Long toss ~200 ft', null, '~200 ft', '20–30 min', 'full', 'Maintenance long toss, moderate intent.'),
  ('Track B', '2026-12-16', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2026-12-17', 'Bullpen', 'Bullpen #1 — 15-20 pitches', null, null, 'Catch play to comfort', 'full', 'Local/turf access: first mound pen, ~75% intent. Home access: continue flat ground instead.'),
  ('Track B', '2026-12-18', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track B', '2026-12-19', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2026-12-20', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2026-12-21', 'Medium', 'Flat ground — breaking balls', null, null, '20–30 min', 'full', '~10 breaking balls off flat ground + changeups.'),
  ('Track B', '2026-12-22', 'Medium', 'Long toss ~200-220 ft', null, '~200-220 ft', '20–30 min', 'full', 'Maintenance long toss, moderate-high intent.'),
  ('Track B', '2026-12-23', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2026-12-24', 'Bullpen', 'Bullpen #2 — 20-25 pitches', null, null, 'Catch play to comfort', 'full', '~80% intent, mix in secondary. Christmas Eve — keep the session short and flexible around family plans. Home access: flat ground continues.'),
  ('Track B', '2026-12-25', 'Off', 'Off — Christmas Day', null, null, null, 'none', 'Holiday — no throwing.'),
  ('Track B', '2026-12-26', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent (shifted from Fri where a holiday lands on it).'),
  ('Track B', '2026-12-27', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2026-12-28', 'Bullpen', 'Bullpen — 25 pitches', null, null, 'Catch play to comfort', 'full', '~85% intent, full mix.'),
  ('Track B', '2026-12-29', 'Medium', 'Long toss / flat recovery', null, '~180 ft', '20–30 min', 'full', 'Easy long toss to ~180 ft, arm care emphasis.'),
  ('Track B', '2026-12-30', 'Bullpen', 'Bullpen — 30 pitches', null, null, 'Catch play to comfort', 'full', '~85-90% intent, full mix, command focus.'),
  ('Track B', '2026-12-31', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Keep it short — New Year''s Eve.'),
  ('Track B', '2027-01-01', 'Off', 'Off — New Year''s Day', null, null, null, 'none', 'Holiday — no throwing.'),
  ('Track B', '2027-01-02', 'Bullpen', 'Bullpen — 35 pitches', null, null, 'Catch play to comfort', 'full', 'Final build pen before reconvening — ~90% intent, full mix.'),
  ('Track B', '2027-01-03', 'Off', 'Off', null, null, null, 'none', 'Travel/rest day before team reconvenes Monday.'),
  ('Track B', '2027-01-04', 'Bullpen', 'Bullpen — 30 pitches', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track B', '2027-01-05', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track B', '2027-01-06', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track B', '2027-01-07', 'Live', 'RP: LIVE — 25-30 pitches · 1-2 innings · 1 break', 'SP: LIVE — 25-30 pitches · 1-2 innings · 1 break', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track B', '2027-01-08', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track B', '2027-01-09', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track B', '2027-01-10', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2027-01-11', 'Bullpen', 'Bullpen — 30 pitches', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track B', '2027-01-12', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track B', '2027-01-13', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track B', '2027-01-14', 'Live', 'RP: LIVE — 35-40 pitches · 2 innings · 1 break', 'SP: LIVE — 35-40 pitches · 2 innings · 1 break', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track B', '2027-01-15', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track B', '2027-01-16', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track B', '2027-01-17', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2027-01-18', 'Bullpen', 'Bullpen — 30-35 pitches', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track B', '2027-01-19', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track B', '2027-01-20', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track B', '2027-01-21', 'Live', 'RP: LIVE — 40-45 pitches · 2-3 innings · 1-2 breaks', 'SP: LIVE — 40-45 pitches · 2-3 innings · 1-2 breaks', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track B', '2027-01-22', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track B', '2027-01-23', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track B', '2027-01-24', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2027-01-25', 'Bullpen', 'Bullpen — 30-35 pitches', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track B', '2027-01-26', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track B', '2027-01-27', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track B', '2027-01-28', 'Live', 'RP: LIVE — 50-55 pitches · 3 innings · 2 breaks (role ceiling)', 'SP: LIVE — 50-55 pitches · 3 innings · 2 breaks', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track B', '2027-01-29', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track B', '2027-01-30', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track B', '2027-01-31', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2027-02-01', 'Bullpen', 'Bullpen — 25-30 pitches (lighter)', null, null, 'Catch play to comfort', 'full', 'Bullpen day — building toward Thursday''s live outing.'),
  ('Track B', '2027-02-02', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit, light mobility.'),
  ('Track B', '2027-02-03', 'Low', 'Light catch play', null, null, '10–20 min', 'half', 'Easy catch, no intent.'),
  ('Track B', '2027-02-04', 'Live', 'RP: LIVE — hold 55-60 pitches · 3 innings · 2 breaks (maintenance)', 'SP: LIVE — PEAK 65-75 pitches · 4-5 innings · 2 breaks', null, 'Catch play to comfort', 'full', 'Live at-bats, simulated innings with breaks between frames.'),
  ('Track B', '2027-02-05', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'Day after live — arm care only, no throwing.'),
  ('Track B', '2027-02-06', 'Low', 'Light catch play (optional)', null, null, '10–20 min', 'half', 'Easy, low-intent catch if desired.'),
  ('Track B', '2027-02-07', 'Off', 'Off', null, null, null, 'none', 'Full rest.'),
  ('Track B', '2027-02-08', 'Bullpen', 'Optional tune-up bullpen — 15-20 pitches', null, null, 'Catch play to comfort', 'full', 'Only if a starter needs one final rep. Otherwise off.'),
  ('Track B', '2027-02-09', 'Recovery', 'Recovery / arm care', null, null, null, 'none', 'No throwing — arm care circuit only.'),
  ('Track B', '2027-02-10', 'Low', 'Light catch play / flat ground', null, null, '10–20 min', 'half', 'Easy, no intent.'),
  ('Track B', '2027-02-11', 'Off', 'Off — mental prep', null, null, null, 'none', 'Optional very light flat catch only.'),
  ('Track B', '2027-02-12', 'Game', 'OPENING DAY — Game 1', null, null, 'Catch play to comfort', 'half', 'First game of the season.')
) as v(program, day, kind, title, sp_title, distance, catch_play, plyos, note)
join public.throw_programs p on p.name = v.program
on conflict (program_id, day) do nothing;

notify pgrst, 'reload schema';
select (select count(*) from public.throw_days) as throwing_days_loaded;
