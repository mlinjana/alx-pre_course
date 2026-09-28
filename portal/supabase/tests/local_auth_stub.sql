-- LOCAL TESTING ONLY. Never run this against Supabase.
-- A minimal stand-in for the parts of Supabase the migration relies on:
-- the anon/authenticated/service_role roles, auth.users, auth.uid(), auth.jwt(),
-- and Supabase's default grants on new tables in `public`.
-- auth.uid()/auth.jwt() read the `request.jwt.claims` setting, as Supabase's do.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (id uuid primary key, email text not null);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
