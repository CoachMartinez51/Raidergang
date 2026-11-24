-- =====================================================================
-- The Raidergang — Library tags
--   • exercises.extra_fits: extra "Category > Subcategory" places an
--     exercise also fits, picked in the app. Kept apart from the sheet's
--     "Also Fits" column so the Coaching Database sync never erases them.
--   • throwing_drills.focus: what a drill targets. Coaches only use it;
--     athletes never see it in the app.
-- Safe to re-run.
-- =====================================================================
alter table public.exercises add column if not exists extra_fits text[] not null default '{}';
alter table public.throwing_drills add column if not exists focus text[] not null default '{}';

do $$ begin
  alter table public.throwing_drills add constraint throwing_drills_focus_check check (focus <@ array[
    'Direction', 'Back Leg', 'Front Leg', 'Arm Action', 'Athleticism', 'Drift',
    'Relaxation / Early Extension', 'Front Side']::text[]);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
