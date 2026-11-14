-- A-02: personal preferences only; no accounts, balances or financial movements.
alter table finance.profiles
  add column locale text not null default 'es' check (locale = 'es'),
  add column preferred_currency text check (preferred_currency in ('PEN', 'USD')),
  add column timezone text check (length(timezone) between 1 and 100),
  add column onboarding_completed_at timestamptz,
  add column version integer not null default 0 check (version >= 0),
  add constraint profile_complete check (onboarding_completed_at is null or
    (display_name is not null and preferred_currency is not null and timezone is not null));

grant app_executor to postgres;

create or replace function api.read_profile() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('user_id', p.user_id, 'display_name', p.display_name,
    'locale', p.locale, 'preferred_currency', p.preferred_currency, 'timezone', p.timezone,
    'onboarding_completed_at', p.onboarding_completed_at, 'version', p.version, 'created_at', p.created_at)
  from finance.profiles p
  where finance.request_user_id() is not null and p.user_id = finance.request_user_id();
$$;

create or replace function api.update_profile(p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  if p_display_name is not null and (length(btrim(p_display_name)) < 1 or length(btrim(p_display_name)) > 100) then raise check_violation; end if;
  update finance.profiles set display_name = btrim(p_display_name), updated_at = now(), version = version + 1
    where user_id = finance.request_user_id();
  return api.read_profile();
end $$;

create function api.configure_profile(p_display_name text, p_currency text, p_timezone text, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_profile finance.profiles%rowtype;
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 100
    or p_currency is null or p_currency not in ('PEN', 'USD')
    or p_timezone is null or length(p_timezone) > 100
    or (p_timezone <> 'UTC' and position('/' in p_timezone) = 0)
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone)
    or p_expected_version is null or p_expected_version < 0 then raise check_violation; end if;
  insert into finance.profiles(user_id) values (finance.request_user_id()) on conflict (user_id) do nothing;
  select * into current_profile from finance.profiles where user_id = finance.request_user_id() for update;
  -- A repeated committed request is safe; different stale input never overwrites newer data.
  if current_profile.onboarding_completed_at is not null
    and current_profile.display_name = btrim(p_display_name)
    and current_profile.preferred_currency = p_currency and current_profile.timezone = p_timezone then
    return api.read_profile();
  end if;
  if current_profile.version <> p_expected_version then
    raise exception 'profile_conflict' using errcode = '40001';
  end if;
  update finance.profiles set display_name = btrim(p_display_name), locale = 'es',
    preferred_currency = p_currency, timezone = p_timezone,
    onboarding_completed_at = coalesce(onboarding_completed_at, now()),
    updated_at = now(), version = version + 1 where user_id = finance.request_user_id();
  return api.read_profile();
end $$;

grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.configure_profile(text, text, text, integer) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.configure_profile(text, text, text, integer) from public, anon, authenticated;
grant execute on function api.configure_profile(text, text, text, integer) to authenticated;
revoke app_executor from postgres;
