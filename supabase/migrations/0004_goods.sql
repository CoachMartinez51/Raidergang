-- =====================================================================
-- The Raidergang — Stage 2b: The Goods, goal weight, imported history
-- Run once in Supabase → SQL Editor (after 0001 and 0002).
-- =====================================================================

-- Goal weight shown on the athlete's check-in (free text, e.g. "204-207" or "195 lbs")
alter table public.people add column if not exists goal_weight text;

-- Old weight-log rows often have no readiness score, so allow it to be blank.
-- The app still requires RPE for every new check-in.
alter table public.checkins alter column readiness drop not null;
alter table public.checkins add column if not exists source text not null default 'app'
  check (source in ('app', 'sheet_import'));

-- ---------------------------------------------------------------------
-- The Goods: each athlete's current soft tissue, correctives, feels and
-- plyo drills. Items point at the library by ID; if an item is not in the
-- library it keeps its name in custom_name so nothing is lost.
-- Changing an item = retire the old row (active = false) and add a new one,
-- so the full history stays in this table.
-- ---------------------------------------------------------------------
create table if not exists public.goods_items (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people(id),
  day         text not null check (day in ('A', 'B', 'any')),
  section     text not null check (section in ('soft_tissue', 'correctives', 'feels', 'half_plyos', 'full_plyos')),
  exercise_id uuid references public.exercises(id),
  drill_id    uuid references public.throwing_drills(id),
  custom_name text,
  dose        text,            -- "1-3 min", "2 x 45 sec", "1-2 x 5-8"
  balls       text,            -- plyo ball colors
  note        text,
  sort_order  int not null default 0,
  active      boolean not null default true,
  retired_at  timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.people(id),
  check (exercise_id is not null or drill_id is not null or custom_name is not null)
);
create index if not exists goods_items_person on public.goods_items (person_id, active, day, section, sort_order);

drop trigger if exists goods_items_history on public.goods_items;
create trigger goods_items_history after insert or update or delete on public.goods_items
  for each row execute function public.log_change();
drop trigger if exists goods_items_stamp on public.goods_items;
create trigger goods_items_stamp before insert on public.goods_items
  for each row execute function public.stamp_created_by();

alter table public.goods_items enable row level security;
drop policy if exists "see own goods" on public.goods_items;
create policy "see own goods" on public.goods_items for select to authenticated
  using (person_id = public.me() or public.is_coach());
drop policy if exists "editors manage goods" on public.goods_items;
create policy "editors manage goods" on public.goods_items for insert to authenticated
  with check (public.coach_can_edit());
drop policy if exists "editors retire goods" on public.goods_items;
create policy "editors retire goods" on public.goods_items for update to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());
grant select, insert, update on public.goods_items to authenticated;

-- Readable view with names and video links resolved
create or replace view public.current_goods with (security_invoker = true) as
  select g.id, g.person_id, g.day, g.section, g.sort_order, g.dose, g.balls, g.note,
         g.exercise_id, g.drill_id,
         coalesce(e.name, d.name, g.custom_name) as name,
         coalesce(e.video_url, d.video_url)      as video_url
  from public.goods_items g
  left join public.exercises e on e.id = g.exercise_id
  left join public.throwing_drills d on d.id = g.drill_id
  where g.active;
grant select on public.current_goods to authenticated;
