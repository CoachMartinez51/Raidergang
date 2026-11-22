-- Minimal stand-in for Supabase's auth layer, for local testing only.
create role authenticated nologin;
create role anon nologin;
create schema auth;
grant usage on schema auth to authenticated, anon;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
grant execute on all functions in schema auth to authenticated, anon;
