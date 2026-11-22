-- Security tests. Run after stub_supabase.sql + migrations.
\set ON_ERROR_STOP off
\set QUIET on

create or replace function pg_temp.login(p_sub text, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_sub, false);
  perform set_config('request.jwt.claim.email', p_email, false);
end $$;

-- Setup as superuser
select public.bootstrap_admin('Martinez@Gmail.com', 'Myles', 'Martinez') as admin_id \gset
\echo == bootstrap twice should fail
select public.bootstrap_admin('x@gmail.com', 'X', 'Y');

-- Admin signs in
select pg_temp.login('11111111-1111-1111-1111-111111111111', 'martinez@gmail.com');
set role authenticated;
\echo == admin claims profile (expect id)
select public.claim_profile() is not null as admin_claimed;
\echo == admin adds coach (view-only) + two athletes
insert into public.people (email, first_name, last_name, is_coach, coach_can_edit) values ('viewer@gmail.com','View','Coach', true, false);
insert into public.people (email, first_name, last_name, is_pitcher) values ('jarvis@gmail.com','Connor','Jarvis', true);
insert into public.people (email, first_name, last_name, is_position_player) values ('wood@gmail.com','Ethan','Wood', true);
select count(*) as people_visible_to_admin from public.people;
reset role;

-- Stranger signs in (not invited)
select pg_temp.login('99999999-9999-9999-9999-999999999999', 'stranger@gmail.com');
set role authenticated;
\echo == stranger: claim null, sees 0 people, cannot check in
select public.claim_profile() as stranger_claim;
select count(*) as stranger_sees from public.people;
insert into public.checkins (person_id, checkin_date, readiness) select id, current_date, 5 from public.people limit 1;
select count(*) as stranger_sees_exercises from public.exercises;
reset role;

-- Jarvis signs in
select pg_temp.login('22222222-2222-2222-2222-222222222222', 'JARVIS@gmail.com');
set role authenticated;
\echo == jarvis claims, sees only himself
select public.claim_profile() is not null as jarvis_claimed;
select count(*) as jarvis_sees_people from public.people;
\echo == jarvis checks in twice same day (append-only), current view shows newest
insert into public.checkins (person_id, checkin_date, bodyweight, readiness, note) values (public.me(), current_date, 201.4, 7, 'slept well');
insert into public.checkins (person_id, checkin_date, bodyweight, readiness) values (public.me(), current_date, 201.6, 8);
select count(*) as raw_rows, (select readiness from public.current_checkins where person_id = public.me() and checkin_date = current_date) as current_rpe from public.checkins;
\echo == jarvis cannot update/delete a check-in (expect permission denied)
update public.checkins set readiness = 10;
delete from public.checkins;
\echo == jarvis cannot check in for someone else (expect RLS error)
insert into public.checkins (person_id, checkin_date, readiness) values (:'admin_id', current_date, 5);
\echo == jarvis cannot backdate a month (expect RLS error)
insert into public.checkins (person_id, checkin_date, readiness) values (public.me(), current_date - 30, 5);
\echo == jarvis cannot make himself a coach (expect 0 rows updated)
update public.people set is_coach = true where id = public.me();
select is_coach as jarvis_is_coach from public.people where id = public.me();
\echo == jarvis writes own goal
insert into public.goals (person_id, kind, body) values (public.me(), 'body', 'Get to 205 lb');
reset role;

-- Wood signs in: should not see Jarvis's check-ins
select pg_temp.login('33333333-3333-3333-3333-333333333333', 'wood@gmail.com');
set role authenticated;
select public.claim_profile() is not null as wood_claimed;
\echo == wood sees 0 check-ins and 0 goals
select count(*) as wood_sees_checkins from public.checkins;
select count(*) as wood_sees_goals from public.goals;
reset role;

-- View-only coach
select pg_temp.login('44444444-4444-4444-4444-444444444444', 'viewer@gmail.com');
set role authenticated;
select public.claim_profile() is not null as viewer_claimed;
\echo == viewer sees all people and check-ins
select count(*) as viewer_people, (select count(*) from public.current_checkins) as viewer_current_checkins from public.people;
\echo == viewer cannot edit a person (expect 0 rows) or add one (expect error)
update public.people set last_name = 'Changed' where email = 'wood@gmail.com';
insert into public.people (email, first_name, last_name) values ('new@gmail.com','N','P');
\echo == viewer cannot add exercise (expect error)
insert into public.exercises (name, category) values ('Test','Core');
reset role;

-- Admin: edit + history, cannot remove last admin
select pg_temp.login('11111111-1111-1111-1111-111111111111', 'martinez@gmail.com');
set role authenticated;
\echo == admin adds exercise, edits athlete; history recorded
insert into public.exercises (name, category, subcategory) values ('BB RDL','Lower Body Lifts','Foundational Movements');
update public.people set aliases = array['Jarvis, C'] where email = 'jarvis@gmail.com';
select table_name, action, (select first_name from public.people p where p.id = changed_by) as by from public.change_history order by id desc limit 3;
\echo == admin removing own admin flag (expect error: must keep one admin)
update public.people set is_admin = false where email = 'martinez@gmail.com';
reset role;
\echo == done
