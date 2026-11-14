-- A-06: executed income/expense only. Entries, events and idempotency commit together.
create table finance.transactions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references finance.profiles(user_id) on delete cascade,
  create_request_id uuid not null,
  kind text not null check (kind in ('income','expense')),
  description text not null check (length(description) between 1 and 200 and description=btrim(description)),
  note text not null default '' check (length(note)<=2000),
  amount numeric(20,4) not null check (amount>0 and amount<=9999999999999999.99 and amount=trunc(amount,2) and amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  currency_code text not null references finance.currencies(code),
  category_id uuid not null,
  requested_occurred_at timestamptz,
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  status text not null default 'posted' check (status in ('posted','void')),
  version integer not null default 1 check (version>0),
  recorded_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  unique(user_id,id), unique(user_id,create_request_id),
  foreign key(user_id,category_id) references finance.categories(user_id,id),
  check ((status='posted' and voided_at is null and void_reason is null) or
    (status='void' and voided_at is not null and void_reason is not null and length(btrim(void_reason)) between 1 and 300))
);
create table finance.transaction_entries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null, transaction_id uuid not null, account_id uuid not null,
  signed_amount numeric(20,4) not null check (signed_amount<>0 and signed_amount=trunc(signed_amount,2) and signed_amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  created_at timestamptz not null default now(),
  unique(user_id,id), unique(user_id,transaction_id),
  foreign key(user_id,transaction_id) references finance.transactions(user_id,id) on delete cascade,
  foreign key(user_id,account_id) references finance.accounts(user_id,id)
);
create index transactions_history on finance.transactions(user_id,occurred_at desc,id desc);
create index transaction_entries_account on finance.transaction_entries(user_id,account_id,transaction_id);
create table finance.transaction_events (
  id uuid primary key default pg_catalog.gen_random_uuid(), user_id uuid not null, transaction_id uuid not null,
  action text not null check (action in ('posted','voided')), version integer not null,
  recorded_at timestamptz not null default now(), unique(user_id,transaction_id,version),
  foreign key(user_id,transaction_id) references finance.transactions(user_id,id) on delete cascade
);
alter table finance.transactions enable row level security;
alter table finance.transactions force row level security;
alter table finance.transaction_entries enable row level security;
alter table finance.transaction_entries force row level security;
alter table finance.transaction_events enable row level security;
alter table finance.transaction_events force row level security;
revoke all on finance.transactions,finance.transaction_entries,finance.transaction_events from public,anon,authenticated;
grant select,insert,update on finance.transactions to app_executor;
grant select,insert on finance.transaction_entries,finance.transaction_events to app_executor;
create policy transactions_read on finance.transactions for select to app_executor using(user_id=(select finance.request_user_id()));
create policy transactions_insert on finance.transactions for insert to app_executor with check(user_id=(select finance.request_user_id()));
create policy transactions_update on finance.transactions for update to app_executor using(user_id=(select finance.request_user_id())) with check(user_id=(select finance.request_user_id()));
create policy entries_read on finance.transaction_entries for select to app_executor using(user_id=(select finance.request_user_id()));
create policy entries_insert on finance.transaction_entries for insert to app_executor with check(user_id=(select finance.request_user_id()));
create policy transaction_events_read on finance.transaction_events for select to app_executor using(user_id=(select finance.request_user_id()));
create policy transaction_events_insert on finance.transaction_events for insert to app_executor with check(user_id=(select finance.request_user_id()));

create function finance.guard_transaction() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'posted' or new.version<>1 or new.occurred_at>clock_timestamp() then raise check_violation; end if;
  else
    if new.id<>old.id or new.user_id<>old.user_id or new.create_request_id<>old.create_request_id
      or new.kind<>old.kind or new.description<>old.description or new.note<>old.note or new.amount<>old.amount
      or new.currency_code<>old.currency_code or new.category_id<>old.category_id
      or new.requested_occurred_at is distinct from old.requested_occurred_at or new.occurred_at<>old.occurred_at
      or new.recorded_at<>old.recorded_at or old.status<>'posted' or new.status<>'void' or new.version<>old.version+1 then raise check_violation; end if;
  end if;
  return new;
end $$;
create trigger transaction_identity before insert or update on finance.transactions for each row execute function finance.guard_transaction();

create function finance.check_transaction_entries() returns trigger language plpgsql security invoker set search_path='' as $$
declare t finance.transactions%rowtype; target uuid; entry_count integer;
begin
  if tg_table_name='transactions' then target:=new.id; else target:=new.transaction_id; end if;
  select * into t from finance.transactions where user_id=new.user_id and id=target;
  select count(*) into entry_count from finance.transaction_entries where user_id=new.user_id and transaction_id=target;
  if not found or entry_count<>1 or not exists(
    select 1 from finance.transaction_entries e join finance.accounts a on a.user_id=e.user_id and a.id=e.account_id
    join finance.categories c on c.user_id=t.user_id and c.id=t.category_id
    where e.user_id=t.user_id and e.transaction_id=t.id and a.currency_code=t.currency_code and c.kind=t.kind
      and t.occurred_at>=a.opening_at and e.signed_amount=case when t.kind='income' then t.amount else -t.amount end
  ) then raise check_violation; end if;
  return null;
end $$;
create constraint trigger transaction_complete after insert or update on finance.transactions deferrable initially deferred for each row execute function finance.check_transaction_entries();
create constraint trigger entries_complete after insert on finance.transaction_entries deferrable initially deferred for each row execute function finance.check_transaction_entries();
revoke all on function finance.guard_transaction(),finance.check_transaction_entries() from public,anon,authenticated;

-- Keep the same identity guard and add the no-history aperture invariant.
create or replace function finance.guard_account_identity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.opening_at>clock_timestamp() then raise check_violation; end if;
  if tg_op='UPDATE' then
    if new.id<>old.id or new.user_id<>old.user_id or new.currency_code<>old.currency_code or new.type<>old.type
      or new.opening_at<>old.opening_at or new.created_at<>old.created_at or new.create_request_id<>old.create_request_id
      or new.version<>old.version+1 then raise check_violation; end if;
    if new.opening_balance<>old.opening_balance and exists(select 1 from finance.transaction_entries where user_id=old.user_id and account_id=old.id) then
      raise exception 'opening_has_history' using errcode='55000';
    end if;
  end if;
  return new;
end $$;

grant app_executor to postgres;
create or replace function api.read_accounts() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'type',a.type,'currency_code',a.currency_code,
    'opening_minor',(a.opening_balance*100)::numeric(20,0)::text,'opening_at',a.opening_at,'status',a.status,'version',a.version,
    'can_edit_opening',not exists(select 1 from finance.transaction_entries h where h.user_id=a.user_id and h.account_id=a.id),
    'balance_minor',((a.opening_balance+coalesce((select sum(e.signed_amount) from finance.transaction_entries e
       join finance.transactions t on t.user_id=e.user_id and t.id=e.transaction_id where e.user_id=a.user_id and e.account_id=a.id
       and t.status='posted' and t.occurred_at<=clock_timestamp()),0))*100)::numeric(20,0)::text) order by a.created_at,a.id),'[]'::jsonb)
    from finance.accounts a where a.user_id=finance.request_user_id());
end $$;

create or replace function api.update_account(p_id uuid,p_name text,p_opening text,p_archived boolean,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing finance.accounts%rowtype; amount numeric; next_status text;
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=finance.request_user_id() and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 100 or p_opening is null
    or p_opening !~ '^-?[0-9]{1,16}(\.[0-9]{1,2})?$' or p_archived is null or p_expected_version is null or p_expected_version<1 then raise check_violation; end if;
  amount:=p_opening::numeric; next_status:=case when p_archived then 'archived' else 'active' end;
  select * into existing from finance.accounts where user_id=finance.request_user_id() and id=p_id for update;
  if not found then raise no_data_found; end if;
  if existing.name=btrim(p_name) and existing.opening_balance=amount and existing.status=next_status then
    return(select value from jsonb_array_elements(api.read_accounts()) where value->>'id'=p_id::text);
  end if;
  if existing.version<>p_expected_version then raise serialization_failure; end if;
  update finance.accounts set name=btrim(p_name),opening_balance=amount,status=next_status,version=version+1,updated_at=now()
    where user_id=finance.request_user_id() and id=p_id;
  insert into finance.account_events(user_id,account_id,action,version) values(finance.request_user_id(),p_id,
    case when existing.status<>next_status then case when p_archived then 'archived' else 'restored' end else 'updated' end,existing.version+1);
  return(select value from jsonb_array_elements(api.read_accounts()) where value->>'id'=p_id::text);
end $$;
revoke app_executor from postgres;

create function api.post_movement(p_request_id uuid,p_kind text,p_account_id uuid,p_category_id uuid,p_amount text,p_description text,p_note text,p_occurred_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; existing finance.transactions%rowtype; account finance.accounts%rowtype; category finance.categories%rowtype;
  amount numeric; target uuid; moment timestamptz; balance numeric;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_request_id is null or p_kind is null or p_kind not in ('income','expense') or p_account_id is null or p_category_id is null
    or p_amount is null or p_amount !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' or p_description is null or length(btrim(p_description)) not between 1 and 200
    or p_note is null or length(btrim(p_note))>2000 then raise check_violation; end if;
  amount:=p_amount::numeric; if amount<=0 then raise check_violation; end if;
  select * into existing from finance.transactions where user_id=owned and create_request_id=p_request_id;
  if found then
    if existing.kind=p_kind and existing.category_id=p_category_id and existing.amount=amount and existing.description=btrim(p_description)
      and existing.note=btrim(p_note) and existing.requested_occurred_at is not distinct from p_occurred_at
      and exists(select 1 from finance.transaction_entries where user_id=owned and transaction_id=existing.id and account_id=p_account_id) then
      return jsonb_build_object('id',existing.id,'status',existing.status);
    end if;
    raise serialization_failure;
  end if;
  if (select count(*) from finance.transactions where user_id=owned)>=10000 then raise program_limit_exceeded; end if;
  select * into account from finance.accounts where user_id=owned and id=p_account_id for update;
  if not found then raise no_data_found; end if;
  select * into category from finance.categories where user_id=owned and id=p_category_id for update;
  if not found then raise no_data_found; end if;
  if account.status<>'active' or category.status<>'active' or category.kind<>p_kind then raise check_violation; end if;
  if category.parent_id is not null then
    perform 1 from finance.categories where user_id=owned and id=category.parent_id and status='active' for update;
    if not found then raise check_violation; end if;
  end if;
  moment:=coalesce(p_occurred_at,clock_timestamp());
  if not isfinite(moment) or moment<account.opening_at or moment>clock_timestamp() then raise datetime_field_overflow; end if;
  select account.opening_balance+coalesce(sum(e.signed_amount),0) into balance from finance.transaction_entries e
    join finance.transactions t on t.user_id=e.user_id and t.id=e.transaction_id where e.user_id=owned and e.account_id=account.id and t.status='posted';
  balance:=balance+case when p_kind='income' then amount else -amount end;
  if abs(balance)>9999999999999999.99 then raise numeric_value_out_of_range; end if;
  insert into finance.transactions(user_id,create_request_id,kind,description,note,amount,currency_code,category_id,requested_occurred_at,occurred_at)
    values(owned,p_request_id,p_kind,btrim(p_description),btrim(p_note),amount,account.currency_code,p_category_id,p_occurred_at,moment) returning id into target;
  insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) values(owned,target,account.id,case when p_kind='income' then amount else -amount end);
  insert into finance.transaction_events(user_id,transaction_id,action,version) values(owned,target,'posted',1);
  return jsonb_build_object('id',target,'status','posted');
end $$;

create function api.void_movement(p_id uuid,p_expected_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owned uuid; existing finance.transactions%rowtype; account_id uuid; balance numeric;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_id is null or p_expected_version is null or p_expected_version<1 or p_reason is null or length(btrim(p_reason)) not between 1 and 300 then raise check_violation; end if;
  select * into existing from finance.transactions where user_id=owned and id=p_id for update;
  if not found then raise no_data_found; end if;
  if existing.status='void' then return jsonb_build_object('id',existing.id,'status','void'); end if;
  if existing.version<>p_expected_version then raise serialization_failure; end if;
  select e.account_id into account_id from finance.transaction_entries e where e.user_id=owned and e.transaction_id=p_id;
  perform 1 from finance.accounts a where a.user_id=owned and a.id=account_id for update;
  select a.opening_balance+coalesce((select sum(e.signed_amount) from finance.transaction_entries e join finance.transactions t on t.user_id=e.user_id and t.id=e.transaction_id
    where e.user_id=owned and e.account_id=a.id and t.status='posted' and t.id<>p_id),0) into balance from finance.accounts a where a.user_id=owned and a.id=account_id;
  if abs(balance)>9999999999999999.99 then raise numeric_value_out_of_range; end if;
  update finance.transactions set status='void',version=version+1,voided_at=clock_timestamp(),void_reason=btrim(p_reason) where user_id=owned and id=p_id;
  insert into finance.transaction_events(user_id,transaction_id,action,version) values(owned,p_id,'voided',existing.version+1);
  return jsonb_build_object('id',p_id,'status','void');
end $$;

create function api.read_movements(p_currency text default 'PEN',p_kind text default null,p_account_id uuid default null,p_category_id uuid default null,
  p_from date default null,p_to date default null,p_query text default '',p_cursor_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 25,p_status text default 'all')
returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; zone text;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  select timezone into zone from finance.profiles where user_id=owned and onboarding_completed_at is not null;
  if not found then raise insufficient_privilege; end if;
  if p_currency is null or p_currency not in ('PEN','USD') or (p_kind is not null and p_kind not in ('income','expense'))
    or p_query is null or length(p_query)>200 or p_limit is null or p_limit not between 1 and 50
    or (p_cursor_at is null)<>(p_cursor_id is null) or (p_cursor_at is not null and not isfinite(p_cursor_at))
    or (p_from is not null and not isfinite(p_from)) or (p_to is not null and not isfinite(p_to))
    or (p_from is not null and p_to is not null and p_from>p_to) or p_status is null or p_status not in ('all','posted','void') then raise check_violation; end if;
  return (with filtered as materialized (
    select t.*,e.account_id,a.name as account_name,c.name as category_name,p.name as parent_name,
      (t.amount*100)::numeric(20,0)::text as amount_minor
    from finance.transactions t join finance.transaction_entries e on e.user_id=t.user_id and e.transaction_id=t.id
      join finance.accounts a on a.user_id=e.user_id and a.id=e.account_id
      join finance.categories c on c.user_id=t.user_id and c.id=t.category_id
      left join finance.categories p on p.user_id=c.user_id and p.id=c.parent_id
    where t.user_id=owned and t.currency_code=p_currency and (p_kind is null or t.kind=p_kind)
      and (p_status='all' or t.status=p_status) and (p_account_id is null or e.account_id=p_account_id)
      and (p_category_id is null or c.id=p_category_id or c.parent_id=p_category_id)
      and (p_from is null or t.occurred_at>=(p_from::timestamp at time zone zone))
      and (p_to is null or t.occurred_at<((p_to+1)::timestamp at time zone zone))
      and (p_query='' or strpos(lower(t.description||' '||t.note),lower(p_query))>0)
  ), page as (select * from filtered where p_cursor_at is null or (occurred_at,id)<(p_cursor_at,p_cursor_id) order by occurred_at desc,id desc limit p_limit+1),
  shown as (select * from page order by occurred_at desc,id desc limit p_limit)
  select jsonb_build_object('currency_code',p_currency,'total_count',(select count(*) from filtered),
    'income_minor',(select (coalesce(sum(amount) filter(where kind='income' and status='posted'),0)*100)::numeric(30,0)::text from filtered),
    'expense_minor',(select (coalesce(sum(amount) filter(where kind='expense' and status='posted'),0)*100)::numeric(30,0)::text from filtered),
    'has_more',(select count(*)>p_limit from page),
    'next_cursor',case when (select count(*)>p_limit from page) then (select jsonb_build_object('at',occurred_at,'id',id) from shown order by occurred_at,id limit 1) else null end,
    'movements',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'description',description,'note',note,'amount_minor',amount_minor,
      'currency_code',currency_code,'account_id',account_id,'account_name',account_name,'category_id',category_id,'category_name',category_name,
      'parent_name',parent_name,'occurred_at',occurred_at,'status',status,'version',version,'void_reason',void_reason) order by occurred_at desc,id desc),'[]'::jsonb) from shown)));
end $$;

grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.post_movement(uuid,text,uuid,uuid,text,text,text,timestamptz) owner to app_executor;
alter function api.void_movement(uuid,integer,text) owner to app_executor;
alter function api.read_movements(text,text,uuid,uuid,date,date,text,timestamptz,uuid,integer,text) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.post_movement(uuid,text,uuid,uuid,text,text,text,timestamptz),api.void_movement(uuid,integer,text),api.read_movements(text,text,uuid,uuid,date,date,text,timestamptz,uuid,integer,text) from public,anon,authenticated;
grant execute on function api.post_movement(uuid,text,uuid,uuid,text,text,text,timestamptz),api.void_movement(uuid,integer,text),api.read_movements(text,text,uuid,uuid,date,date,text,timestamptz,uuid,integer,text) to authenticated;
revoke app_executor from postgres;
