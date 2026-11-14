-- A-04: real asset accounts and openings. No transaction ledger in this version.
create table finance.currencies (
  code text primary key check (code in ('PEN', 'USD')),
  minor_units smallint not null check (minor_units = 2)
);
insert into finance.currencies values ('PEN', 2), ('USD', 2);
revoke all on finance.currencies from public, anon, authenticated;
grant select on finance.currencies to app_executor;

create table finance.accounts (
  id uuid primary key,
  user_id uuid not null references finance.profiles(user_id) on delete cascade,
  name text not null check (length(name) between 1 and 100 and name = btrim(name)),
  type text not null check (type in ('cash', 'bank', 'savings', 'custom')),
  currency_code text not null references finance.currencies(code),
  opening_balance numeric(20,4) not null check (opening_balance = trunc(opening_balance, 2)),
  opening_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'archived')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, id)
);
create table finance.account_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  action text not null check (action in ('created', 'updated', 'archived', 'restored')),
  version integer not null,
  recorded_at timestamptz not null default now(),
  foreign key (user_id, account_id) references finance.accounts(user_id, id) on delete cascade,
  unique(user_id, account_id, version)
);
alter table finance.accounts enable row level security;
alter table finance.accounts force row level security;
alter table finance.account_events enable row level security;
alter table finance.account_events force row level security;
revoke all on finance.accounts, finance.account_events from public, anon, authenticated;
grant select, insert, update on finance.accounts to app_executor;
grant select, insert on finance.account_events to app_executor;
create policy accounts_read on finance.accounts for select to app_executor using (user_id = (select finance.request_user_id()));
create policy accounts_insert on finance.accounts for insert to app_executor with check (user_id = (select finance.request_user_id()));
create policy accounts_update on finance.accounts for update to app_executor using (user_id = (select finance.request_user_id())) with check (user_id = (select finance.request_user_id()));
create policy account_events_read on finance.account_events for select to app_executor using (user_id = (select finance.request_user_id()));
create policy account_events_insert on finance.account_events for insert to app_executor with check (user_id = (select finance.request_user_id()));

create function api.read_accounts() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type,
    'currency_code', a.currency_code, 'opening_minor', (a.opening_balance * 100)::numeric(20,0)::text,
    'opening_at', a.opening_at, 'status', a.status, 'version', a.version) order by a.created_at, a.id), '[]'::jsonb)
    from finance.accounts a where a.user_id = finance.request_user_id());
end $$;

create function api.create_account(p_request_id uuid, p_name text, p_type text, p_currency text, p_opening text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing finance.accounts%rowtype; amount numeric; owned uuid;
begin
  owned := finance.request_user_id();
  if owned is null then raise insufficient_privilege; end if;
  if p_request_id is null or p_name is null or length(btrim(p_name)) not between 1 and 100
    or p_type is null or p_type not in ('cash','bank','savings','custom')
    or p_currency is null or p_currency not in ('PEN','USD')
    or p_opening is null or p_opening !~ '^-?[0-9]{1,16}(\.[0-9]{1,2})?$' then raise check_violation; end if;
  amount := p_opening::numeric;
  perform 1 from finance.profiles p where p.user_id = owned and p.onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  select * into existing from finance.accounts where user_id = owned and id = p_request_id for update;
  if found then
    if existing.name = btrim(p_name) and existing.type = p_type and existing.currency_code = p_currency and existing.opening_balance = amount then
      return (select value from jsonb_array_elements(api.read_accounts()) where value->>'id' = p_request_id::text);
    end if;
    raise exception 'idempotency_conflict' using errcode = '40001';
  end if;
  if (select count(*) from finance.accounts where user_id = owned) >= 100 then raise program_limit_exceeded; end if;
  insert into finance.accounts(id, user_id, name, type, currency_code, opening_balance)
    values (p_request_id, owned, btrim(p_name), p_type, p_currency, amount) on conflict (id) do nothing;
  if not found then raise exception 'idempotency_conflict' using errcode = '40001'; end if;
  insert into finance.account_events(user_id, account_id, action, version) values (owned, p_request_id, 'created', 1);
  return (select value from jsonb_array_elements(api.read_accounts()) where value->>'id' = p_request_id::text);
end $$;

create function api.update_account(p_id uuid, p_name text, p_opening text, p_archived boolean, p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing finance.accounts%rowtype; amount numeric; next_status text; event_action text;
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_opening is null
    or p_opening !~ '^-?[0-9]{1,16}(\.[0-9]{1,2})?$' or p_archived is null
    or p_expected_version is null or p_expected_version < 1 then raise check_violation; end if;
  amount := p_opening::numeric;
  next_status := case when p_archived then 'archived' else 'active' end;
  select * into existing from finance.accounts where user_id = finance.request_user_id() and id = p_id for update;
  if not found then raise no_data_found; end if;
  if existing.name = btrim(p_name) and existing.opening_balance = amount and existing.status = next_status then
    return (select value from jsonb_array_elements(api.read_accounts()) where value->>'id' = p_id::text);
  end if;
  if existing.version <> p_expected_version then raise serialization_failure; end if;
  -- No real movements exist yet. Before enabling a ledger, this same transaction
  -- must reject opening changes once ANY history exists and coordinate row locks.
  event_action := case when existing.status <> next_status then case when p_archived then 'archived' else 'restored' end else 'updated' end;
  update finance.accounts set name = btrim(p_name), opening_balance = amount, status = next_status,
    version = version + 1, updated_at = now() where user_id = finance.request_user_id() and id = p_id;
  insert into finance.account_events(user_id, account_id, action, version) values (finance.request_user_id(), p_id, event_action, existing.version + 1);
  return (select value from jsonb_array_elements(api.read_accounts()) where value->>'id' = p_id::text);
end $$;

grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.read_accounts() owner to app_executor;
alter function api.create_account(uuid,text,text,text,text) owner to app_executor;
alter function api.update_account(uuid,text,text,boolean,integer) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.read_accounts(), api.create_account(uuid,text,text,text,text), api.update_account(uuid,text,text,boolean,integer) from public, anon, authenticated;
grant execute on function api.read_accounts(), api.create_account(uuid,text,text,text,text), api.update_account(uuid,text,text,boolean,integer) to authenticated;
revoke app_executor from postgres;
