-- =====================================================================
-- The Raidergang — Stage 3: lift blocks, Lift Prep, assignments, set logs
-- Run once in Supabase → SQL Editor (after 0001–0004).
-- If Supabase shows "Potential issue detected", choose "Run without RLS":
-- every table below turns RLS on itself.
-- =====================================================================

-- Lift Prep (Movement Prep A, B, …): an ordered list of steps/exercises
create table if not exists public.lift_preps (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  items      jsonb not null default '[]',   -- [{name, exercise_id, video_url}]
  created_at timestamptz not null default now(),
  created_by uuid references public.people(id)
);

create table if not exists public.lift_blocks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  notes      text,
  weeks      smallint not null default 4 check (weeks between 1 and 12),
  -- holiday moves: [{week: 1, weekday: 4, moved_to: "2026-11-27"}]
  date_moves jsonb not null default '[]',
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.people(id)
);

create table if not exists public.block_days (
  id         uuid primary key default gen_random_uuid(),
  block_id   uuid not null references public.lift_blocks(id) on delete cascade,
  weekday    smallint not null check (weekday between 1 and 7),  -- 1 = Monday
  label      text not null,                                     -- "Lower Focus"
  focus      text not null default 'other' check (focus in ('lower', 'upper', 'other')),
  prep_id    uuid references public.lift_preps(id),
  warmup     text,                                              -- "Zercher BB Squat WU (2-3 sets)…"
  sprints    jsonb not null default '[]',                       -- one entry per week, lower days only
  notes      text,
  unique (block_id, weekday)
);

create table if not exists public.block_exercises (
  id           uuid primary key default gen_random_uuid(),
  block_day_id uuid not null references public.block_days(id) on delete cascade,
  slot         text not null,                                   -- A1, A2, B1 …
  sort_order   smallint not null default 0,
  exercise_id  uuid references public.exercises(id),
  custom_name  text,
  video_url    text,                                            -- overrides the library video if set
  rir          text,
  cue          text,
  rehab        text,
  log_type     text not null default 'weight' check (log_type in ('weight', 'done', 'result')),
  result_label text,                                            -- "Inches", "Reps" for result items
  weeks        jsonb not null default '[]',                     -- [{sets, reps, note} | null] per week
  check (exercise_id is not null or custom_name is not null)
);
create index if not exists block_exercises_day on public.block_exercises (block_day_id, sort_order);

create table if not exists public.block_assignments (
  id         uuid primary key default gen_random_uuid(),
  block_id   uuid not null references public.lift_blocks(id),
  person_id  uuid not null references public.people(id),
  start_date date not null,                                     -- the Monday of week 1
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.people(id),
  unique (block_id, person_id, start_date)
);
create index if not exists block_assignments_person on public.block_assignments (person_id, start_date desc);

-- Coach switches one athlete to the rehab option of one exercise
create table if not exists public.rehab_switches (
  id                uuid primary key default gen_random_uuid(),
  person_id         uuid not null references public.people(id),
  block_exercise_id uuid not null references public.block_exercises(id) on delete cascade,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.people(id)
);
create index if not exists rehab_switches_person on public.rehab_switches (person_id, active);

-- What the athlete actually did. Append-only: an edit is a new row, newest wins.
create table if not exists public.set_logs (
  id                uuid primary key default gen_random_uuid(),
  person_id         uuid not null references public.people(id),
  block_exercise_id uuid not null references public.block_exercises(id),
  log_date          date not null,
  week              smallint not null,
  set_number        smallint not null check (set_number between 1 and 20),
  weight            numeric(6,1) check (weight is null or weight between 0 and 2000),
  result            text check (result is null or length(result) <= 40),
  done              boolean not null default false,
  used_rehab        boolean not null default false,
  exercise_name     text not null,        -- copy of what was prescribed that day
  prescribed        text,                 -- e.g. "3 x 6 · RIR 2"
  created_at        timestamptz not null default now(),
  created_by        uuid references public.people(id)
);
create index if not exists set_logs_person on public.set_logs (person_id, log_date desc);
create index if not exists set_logs_exercise on public.set_logs (block_exercise_id, person_id, log_date desc);

create or replace view public.current_set_logs with (security_invoker = true) as
  select distinct on (person_id, block_exercise_id, log_date, set_number) *
  from public.set_logs
  order by person_id, block_exercise_id, log_date, set_number, created_at desc;

-- History + stamps
do $$
declare t text;
begin
  foreach t in array array['lift_preps','lift_blocks','block_days','block_exercises','block_assignments','rehab_switches'] loop
    execute format('drop trigger if exists %1$s_history on public.%1$s', t);
    execute format('create trigger %1$s_history after insert or update or delete on public.%1$s for each row execute function public.log_change()', t);
  end loop;
  foreach t in array array['lift_preps','lift_blocks','block_assignments','rehab_switches','set_logs'] loop
    execute format('drop trigger if exists %1$s_stamp on public.%1$s', t);
    execute format('create trigger %1$s_stamp before insert on public.%1$s for each row execute function public.stamp_created_by()', t);
  end loop;
end $$;

-- Row-level security
alter table public.lift_preps        enable row level security;
alter table public.lift_blocks       enable row level security;
alter table public.block_days        enable row level security;
alter table public.block_exercises   enable row level security;
alter table public.block_assignments enable row level security;
alter table public.rehab_switches    enable row level security;
alter table public.set_logs          enable row level security;

do $$
declare t text;
begin
  foreach t in array array['lift_preps','lift_blocks','block_days','block_exercises'] loop
    execute format('drop policy if exists "signed-in read" on public.%s', t);
    execute format('create policy "signed-in read" on public.%s for select to authenticated using (public.me() is not null)', t);
    execute format('drop policy if exists "editors write" on public.%s', t);
    execute format('create policy "editors write" on public.%s for all to authenticated using (public.coach_can_edit()) with check (public.coach_can_edit())', t);
  end loop;
  foreach t in array array['block_assignments','rehab_switches'] loop
    execute format('drop policy if exists "own or coach read" on public.%s', t);
    execute format('create policy "own or coach read" on public.%s for select to authenticated using (person_id = public.me() or public.is_coach())', t);
    execute format('drop policy if exists "editors write" on public.%s', t);
    execute format('create policy "editors write" on public.%s for all to authenticated using (public.coach_can_edit()) with check (public.coach_can_edit())', t);
  end loop;
end $$;

drop policy if exists "own or coach read" on public.set_logs;
create policy "own or coach read" on public.set_logs for select to authenticated
  using (person_id = public.me() or public.is_coach());
drop policy if exists "log own sets" on public.set_logs;
create policy "log own sets" on public.set_logs for insert to authenticated
  with check (person_id = public.me() and log_date between current_date - 3 and current_date + 1);

grant select, insert, update, delete on public.lift_preps, public.lift_blocks, public.block_days,
  public.block_exercises, public.block_assignments, public.rehab_switches to authenticated;
grant select, insert on public.set_logs to authenticated;
grant select on public.current_set_logs to authenticated;
