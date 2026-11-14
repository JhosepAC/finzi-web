-- Scope creation retries by user, independently of the server-generated account UUID.
alter table finance.accounts add column create_request_id uuid;
update finance.accounts set create_request_id = id;
alter table finance.accounts alter column create_request_id set not null;
alter table finance.accounts alter column id set default pg_catalog.gen_random_uuid();
alter table finance.accounts add unique(user_id, create_request_id);
alter table finance.accounts add constraint account_opening_finite
  check (opening_balance not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric));

create or replace function finance.guard_account_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.opening_at > clock_timestamp() then raise check_violation; end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.user_id <> old.user_id or new.currency_code <> old.currency_code
      or new.type <> old.type or new.opening_at <> old.opening_at or new.created_at <> old.created_at
      or new.create_request_id <> old.create_request_id or new.version <> old.version + 1 then raise check_violation; end if;
  end if;
  return new;
end $$;

grant app_executor to postgres;
create or replace function api.create_account(p_request_id uuid, p_name text, p_type text, p_currency text, p_opening text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing finance.accounts%rowtype; amount numeric; owned uuid; account_id uuid;
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
  select * into existing from finance.accounts where user_id = owned and create_request_id = p_request_id for update;
  if found then
    if existing.name = btrim(p_name) and existing.type = p_type and existing.currency_code = p_currency and existing.opening_balance = amount then
      return (select value from jsonb_array_elements(api.read_accounts()) where value->>'id' = existing.id::text);
    end if;
    raise exception 'idempotency_conflict' using errcode = '40001';
  end if;
  if (select count(*) from finance.accounts where user_id = owned) >= 100 then raise program_limit_exceeded; end if;
  insert into finance.accounts(user_id, create_request_id, name, type, currency_code, opening_balance)
    values (owned, p_request_id, btrim(p_name), p_type, p_currency, amount) returning id into account_id;
  insert into finance.account_events(user_id, account_id, action, version) values (owned, account_id, 'created', 1);
  return (select value from jsonb_array_elements(api.read_accounts()) where value->>'id' = account_id::text);
end $$;
revoke app_executor from postgres;
