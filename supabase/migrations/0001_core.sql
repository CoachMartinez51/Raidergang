-- =====================================================================
-- The Raidergang — core schema (Stage 1)
-- People, groups, goals, daily check-ins, exercise + drill libraries,
-- change history. Run once in Supabase → SQL Editor.
--
-- Principles
--  * Everything is referenced by permanent IDs, never by name.
--  * History is never overwritten: check-ins and goals are append-only.
--    An edit is a new row; the newest row is the current value.
--  * Invite-only: signing in with Google does nothing unless a coach has
--    already added that Gmail to the roster.
-- =====================================================================

create extension if not exists citext;

-- ---------------------------------------------------------------------
-- People (athletes and coaches)
-- ---------------------------------------------------------------------
create table public.people (
  id                  uuid primary key default gen_random_uuid(),
  email               citext not null unique,
  first_name          text not null,
  last_name           text not null,
  aliases             text[] not null default '{}',   -- other spellings seen in old sheets / Trackman
  trackman_pitcher_id text,
  -- athlete role tags (more than one allowed)
  is_pitcher          boolean not null default false,
  is_position_player  boolean not null default false,
  is_individual_pro   boolean not null default false,
  -- coach access
  is_coach            boolean not null default false,
  coach_can_edit      boolean not null default true,  -- false = view-only coach
  is_admin            boolean not null default false, -- manages the roster
  active              boolean not null default true,
  auth_user_id        uuid unique,                    -- filled in on first Google sign-in
  first_signed_in_at  timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.people(id)
);
comment on table public.people is 'Everyone allowed into the app. A Gmail must be here before that person can sign in.';

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,          -- e.g. Group 1, Group 2
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (group_id, person_id)
);

-- ---------------------------------------------------------------------
-- Goals: BODY / BALL / GAME (pitchers). Append-only.
-- ---------------------------------------------------------------------
create table public.goals (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.people(id),
  kind       text not null check (kind in ('body','ball','game')),
  body       text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.people(id)
);
create index goals_person_kind on public.goals (person_id, kind, created_at desc);

create view public.current_goals with (security_invoker = true) as
  select distinct on (person_id, kind) *
  from public.goals
  order by person_id, kind, created_at desc;

-- ---------------------------------------------------------------------
-- Daily check-in: bodyweight + readiness (RPE 1–10) + optional note.
-- Append-only: re-saving the same day adds a new row; newest wins.
-- ---------------------------------------------------------------------
create table public.checkins (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people(id),
  checkin_date date not null,
  bodyweight   numeric(5,1) check (bodyweight is null or bodyweight between 80 and 450),
  readiness    smallint not null check (readiness between 1 and 10),
  note         text check (note is null or length(note) <= 500),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.people(id)
);
create index checkins_person_date on public.checkins (person_id, checkin_date desc, created_at desc);

create view public.current_checkins with (security_invoker = true) as
  select distinct on (person_id, checkin_date) *
  from public.checkins
  order by person_id, checkin_date, created_at desc;

-- ---------------------------------------------------------------------
-- Exercise library (from "Coaching Database (Organized)")
-- ---------------------------------------------------------------------
create table public.exercises (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null,
  subcategory text,
  body_area   text,
  video_url   text,
  also_fits   text,
  old_names   text[] not null default '{}',  -- names used in the old sheets
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.people(id)
);
create unique index exercises_name_unique on public.exercises (lower(name));

create table public.throwing_drills (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  drill_type  text not null check (drill_type in ('Stationary','Dynamic','Finisher','Athletic')),
  reps        text,
  ball_type   text,
  video_url   text,
  also_fits   text,
  old_names   text[] not null default '{}',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.people(id)
);
create unique index throwing_drills_name_unique on public.throwing_drills (lower(name));

-- ---------------------------------------------------------------------
-- Change history (coach audit trail)
-- ---------------------------------------------------------------------
create table public.change_history (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      uuid,
  action      text not null,
  changed_by  uuid,             -- people.id
  changed_at  timestamptz not null default now(),
  old_values  jsonb,
  new_values  jsonb
);
create index change_history_row on public.change_history (table_name, row_id, changed_at desc);

-- =====================================================================
-- Helper functions (run with owner rights so policies can call them)
-- =====================================================================
create or replace function public.me() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.people
  where auth_user_id = auth.uid() and active
$$;

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_coach from public.people where auth_user_id = auth.uid() and active), false)
$$;

create or replace function public.coach_can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_coach and coach_can_edit from public.people where auth_user_id = auth.uid() and active), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.people where auth_user_id = auth.uid() and active), false)
$$;

-- Called by the app right after Google sign-in. Links the Google account
-- to the roster row with the same email. Returns null if not invited.
create or replace function public.claim_profile() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email citext := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_id uuid;
begin
  if auth.uid() is null then return null; end if;

  select id into v_id from public.people where auth_user_id = auth.uid() and active;
  if v_id is not null then return v_id; end if;

  perform set_config('raidergang.claiming', 'on', true);
  update public.people
     set auth_user_id = auth.uid(), first_signed_in_at = now()
   where email = v_email and auth_user_id is null and active
  returning id into v_id;
  return v_id;
end $$;

-- Change-history trigger
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.change_history (table_name, row_id, action, changed_by, old_values, new_values)
  values (
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
    lower(tg_op),
    public.me(),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger people_history          after insert or update or delete on public.people          for each row execute function public.log_change();
create trigger goals_history           after insert                     on public.goals           for each row execute function public.log_change();
create trigger exercises_history       after insert or update or delete on public.exercises       for each row execute function public.log_change();
create trigger throwing_drills_history after insert or update or delete on public.throwing_drills for each row execute function public.log_change();

-- Group membership has no id column, so log it separately
create or replace function public.log_group_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.change_history (table_name, row_id, action, changed_by, old_values, new_values)
  values ('group_members',
          case when tg_op = 'DELETE' then old.person_id else new.person_id end,
          lower(tg_op), public.me(),
          case when tg_op = 'DELETE' then to_jsonb(old) end,
          case when tg_op = 'INSERT' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger group_members_history after insert or delete on public.group_members
  for each row execute function public.log_group_change();

-- Stamp who created a row
create or replace function public.stamp_created_by() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(public.me(), new.created_by);
  return new;
end $$;
create trigger checkins_stamp  before insert on public.checkins        for each row execute function public.stamp_created_by();
create trigger goals_stamp     before insert on public.goals           for each row execute function public.stamp_created_by();
create trigger people_stamp    before insert on public.people          for each row execute function public.stamp_created_by();
create trigger exercises_stamp before insert on public.exercises       for each row execute function public.stamp_created_by();
create trigger drills_stamp    before insert on public.throwing_drills for each row execute function public.stamp_created_by();

-- Non-admins may never change their own access flags or sign-in link
create or replace function public.protect_people_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('raidergang.claiming', true) = 'on' then
    return new;
  end if;
  if not public.is_admin() and auth.uid() is not null then
    if new.is_coach is distinct from old.is_coach
       or new.coach_can_edit is distinct from old.coach_can_edit
       or new.is_admin is distinct from old.is_admin
       or new.auth_user_id is distinct from old.auth_user_id
       or new.email is distinct from old.email
       or new.active is distinct from old.active then
      raise exception 'Only an admin can change access settings';
    end if;
  end if;
  return new;
end $$;
create trigger people_protect before update on public.people
  for each row execute function public.protect_people_columns();

-- Keep at least one active admin
create or replace function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.people where is_admin and active) then
    raise exception 'There must always be at least one active admin';
  end if;
  return null;
end $$;
create constraint trigger people_keep_admin after update or delete on public.people
  deferrable initially deferred for each row execute function public.keep_one_admin();

-- =====================================================================
-- Row-level security
-- =====================================================================
alter table public.people          enable row level security;
alter table public.groups          enable row level security;
alter table public.group_members   enable row level security;
alter table public.goals           enable row level security;
alter table public.checkins        enable row level security;
alter table public.exercises       enable row level security;
alter table public.throwing_drills enable row level security;
alter table public.change_history  enable row level security;

-- people
create policy "see self"            on public.people for select to authenticated using (id = public.me());
create policy "coaches see all"     on public.people for select to authenticated using (public.is_coach());
create policy "admin adds people"   on public.people for insert to authenticated with check (public.is_admin());
create policy "coaches edit people" on public.people for update to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());
-- no delete: deactivate instead (active = false) so history stays intact

-- groups
create policy "signed-in see groups" on public.groups for select to authenticated using (public.me() is not null);
create policy "editors manage groups" on public.groups for all to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());
create policy "see own membership"   on public.group_members for select to authenticated
  using (person_id = public.me() or public.is_coach());
create policy "editors manage members" on public.group_members for all to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());

-- goals (append-only)
create policy "see own goals"    on public.goals for select to authenticated using (person_id = public.me() or public.is_coach());
create policy "write own goals"  on public.goals for insert to authenticated
  with check (person_id = public.me() or public.coach_can_edit());

-- check-ins (append-only; athletes write only their own)
create policy "see own checkins"   on public.checkins for select to authenticated using (person_id = public.me() or public.is_coach());
create policy "write own checkin"  on public.checkins for insert to authenticated
  with check (person_id = public.me() and checkin_date between current_date - 3 and current_date + 1);

-- libraries
create policy "signed-in see exercises" on public.exercises for select to authenticated using (public.me() is not null);
create policy "editors manage exercises" on public.exercises for all to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());
create policy "signed-in see drills" on public.throwing_drills for select to authenticated using (public.me() is not null);
create policy "editors manage drills" on public.throwing_drills for all to authenticated
  using (public.coach_can_edit()) with check (public.coach_can_edit());

-- history: coaches read, nobody writes directly
create policy "coaches read history" on public.change_history for select to authenticated using (public.is_coach());

grant usage on schema public to authenticated;
grant select, insert, update on public.people to authenticated;
grant select, insert, update, delete on public.groups, public.group_members to authenticated;
grant select, insert on public.goals, public.checkins to authenticated;
grant select, insert, update on public.exercises, public.throwing_drills to authenticated;
grant select on public.change_history, public.current_goals, public.current_checkins to authenticated;
grant execute on function public.me(), public.is_coach(), public.coach_can_edit(),
  public.is_admin(), public.claim_profile() to authenticated;
revoke all on all tables in schema public from anon;

-- =====================================================================
-- First admin. Replace the email, run once, then sign in with it.
--   select public.bootstrap_admin('you@gmail.com', 'Myles', 'Martinez');
-- Only works while there are no people yet.
-- =====================================================================
create or replace function public.bootstrap_admin(p_email text, p_first text, p_last text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if exists (select 1 from public.people) then
    raise exception 'Roster already started; add people from the app instead';
  end if;
  insert into public.people (email, first_name, last_name, is_coach, coach_can_edit, is_admin)
  values (lower(p_email), p_first, p_last, true, true, true)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.bootstrap_admin(text, text, text) from public, anon, authenticated;
