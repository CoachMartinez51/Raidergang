-- =====================================================================
-- The Raidergang — lift alternatives, AMRAP/ALAP, Goods note
--   • set_logs.alt: per set, a band or bodyweight in place of a weight
--   • set_logs.reps_done / seconds_done: for AMRAP and ALAP sets
--   • people.goods_note: the coach's note shown at the top of The Goods
--     (moves the notes the sheet import had attached to a Feels drill)
-- Safe to re-run.
-- =====================================================================

alter table public.set_logs add column if not exists alt text;
alter table public.set_logs add column if not exists reps_done smallint;
alter table public.set_logs add column if not exists seconds_done integer;

do $$ begin
  alter table public.set_logs add constraint set_logs_alt_check check (alt is null or alt in (
    'Bodyweight', 'Single Orange Band', 'Single Red Band', 'Single Green Band', 'Single Black Band',
    'Double Orange', 'Double Red', 'Double Green', 'Red & Orange', 'Green & Red'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.set_logs add constraint set_logs_reps_done_check check (reps_done is null or reps_done between 0 and 500);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.set_logs add constraint set_logs_seconds_done_check check (seconds_done is null or seconds_done between 0 and 3600);
exception when duplicate_object then null; end $$;

-- the "latest per set" view picks up the new columns
create or replace view public.current_set_logs with (security_invoker = true) as
  select distinct on (person_id, block_exercise_id, log_date, set_number) *
  from public.set_logs
  order by person_id, block_exercise_id, log_date, set_number, created_at desc;

-- Goods note
alter table public.people add column if not exists goods_note text;
do $$ begin
  alter table public.people add constraint people_goods_note_len check (goods_note is null or length(goods_note) <= 1000);
exception when duplicate_object then null; end $$;

-- Move each athlete's sheet note off the Feels drill and onto their Goods (only once)
update public.people p
   set goods_note = g.note
  from (select distinct on (person_id) person_id, note
          from public.goods_items
         where note is not null and section = 'feels' and retired_at is null
         order by person_id, sort_order) g
 where p.id = g.person_id and p.goods_note is null;

update public.goods_items g
   set note = null
  from public.people p
 where p.id = g.person_id and g.section = 'feels' and g.note is not null and g.note = p.goods_note;

notify pgrst, 'reload schema';
