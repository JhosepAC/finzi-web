-- AUTH only. No financial entities, credentials or session-token tables.
create schema if not exists finance;
create schema if not exists api;
revoke all on schema finance from public, anon, authenticated;
revoke all on schema api from public, anon;
grant usage on schema api to authenticated;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'app_executor') then
    create role app_executor nologin noinherit nobypassrls;
  end if;
end $$;

grant usage on schema finance to app_executor;

create table finance.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or (length(display_name) between 1 and 100 and display_name = btrim(display_name))),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table finance.profiles enable row level security;
alter table finance.profiles force row level security;
revoke all on finance.profiles from public, anon, authenticated;
grant select, insert, update on finance.profiles to app_executor;

-- Narrow private helper: Supabase owns the auth schema, so custom roles cannot be granted
-- its USAGE by the managed postgres role. This helper returns only auth.uid(), never rows.
create function finance.request_user_id() returns uuid
language sql stable security definer set search_path = '' as $$ select auth.uid(); $$;
revoke execute on function finance.request_user_id() from public, anon, authenticated;
grant execute on function finance.request_user_id() to app_executor;

create policy profiles_read_own on finance.profiles for select to app_executor
  using ((select finance.request_user_id()) is not null and user_id = (select finance.request_user_id()));
create policy profiles_insert_own on finance.profiles for insert to app_executor
  with check ((select finance.request_user_id()) is not null and user_id = (select finance.request_user_id()));
create policy profiles_update_own on finance.profiles for update to app_executor
  using ((select finance.request_user_id()) is not null and user_id = (select finance.request_user_id()))
  with check ((select finance.request_user_id()) is not null and user_id = (select finance.request_user_id()));

-- Global PUBLIC execute defaults must be revoked for the actual function-creating role.
alter default privileges revoke execute on functions from public;
alter default privileges in schema api revoke execute on functions from anon, authenticated;

create function api.ensure_profile() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  insert into finance.profiles(user_id) values (finance.request_user_id()) on conflict (user_id) do nothing;
  select jsonb_build_object('user_id', p.user_id, 'display_name', p.display_name, 'created_at', p.created_at)
    into result from finance.profiles p where p.user_id = finance.request_user_id();
  return result;
end $$;

create function api.read_profile() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('user_id', p.user_id, 'display_name', p.display_name, 'created_at', p.created_at)
    from finance.profiles p where finance.request_user_id() is not null and p.user_id = finance.request_user_id();
$$;

create function api.update_profile(p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  if p_display_name is not null and (length(btrim(p_display_name)) < 1 or length(btrim(p_display_name)) > 100) then
    raise check_violation;
  end if;
  update finance.profiles set display_name = btrim(p_display_name), updated_at = now()
    where user_id = finance.request_user_id();
  select api.read_profile() into result;
  return result;
end $$;

-- The executor owns functions, never tables; it neither inherits authenticated nor bypasses RLS.
grant usage on schema api to app_executor;
-- Supabase's postgres role is not superuser. Temporarily authorize the owner transfer.
grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.ensure_profile() owner to app_executor;
alter function api.read_profile() owner to app_executor;
alter function api.update_profile(text) owner to app_executor;
revoke create on schema api from app_executor;
revoke execute on all functions in schema api from public, anon, authenticated;
grant execute on function api.ensure_profile(), api.read_profile(), api.update_profile(text) to authenticated;
grant execute on function api.read_profile() to app_executor;
revoke app_executor from postgres;
