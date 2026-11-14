-- A-07: same-currency transfers and immutable, linked corrections.
grant app_executor to postgres;
alter table finance.transactions drop constraint transactions_kind_check;
alter table finance.transactions add constraint transactions_kind_check check(kind in ('income','expense','transfer'));
alter table finance.transactions alter column category_id drop not null;
alter table finance.transactions add constraint transactions_category_kind check((kind='transfer' and category_id is null) or (kind<>'transfer' and category_id is not null));
alter table finance.transactions add column replaces_transaction_id uuid;
alter table finance.transactions add column replacement_reason text;
alter table finance.transactions add column replaces_version integer;
alter table finance.transactions add constraint transactions_replacement_check check(
  (replaces_transaction_id is null and replacement_reason is null and replaces_version is null) or
  (replaces_transaction_id is not null and replaces_transaction_id<>id and replacement_reason is not null and length(btrim(replacement_reason)) between 1 and 300 and replaces_version is not null and replaces_version>0));
alter table finance.transactions add constraint transactions_replaces_fk foreign key(user_id,replaces_transaction_id) references finance.transactions(user_id,id);
create unique index transactions_one_successor on finance.transactions(user_id,replaces_transaction_id) where replaces_transaction_id is not null;
alter table finance.transaction_entries drop constraint transaction_entries_user_id_transaction_id_key;
alter table finance.transaction_entries add constraint entries_one_account unique(user_id,transaction_id,account_id);
alter table finance.transaction_events drop constraint transaction_events_action_check;
alter table finance.transaction_events add constraint transaction_events_action_check check(action in ('posted','voided','replaced'));

create or replace function finance.guard_transaction() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'posted' or new.version<>1 or new.occurred_at>clock_timestamp() then raise check_violation; end if;
  else
    if (to_jsonb(new)-array['status','version','voided_at','void_reason']) is distinct from (to_jsonb(old)-array['status','version','voided_at','void_reason'])
      or old.status<>'posted' or new.status<>'void' or new.version<>old.version+1 then raise check_violation; end if;
  end if;
  return new;
end $$;

create or replace function finance.check_transaction_entries() returns trigger language plpgsql security definer set search_path='' as $$
declare t finance.transactions%rowtype; target uuid; entry_count integer; valid_count integer;
begin
  if tg_table_name='transactions' then target:=new.id; else target:=new.transaction_id; end if;
  select * into t from finance.transactions where user_id=new.user_id and id=target;
  if not found then raise check_violation; end if;
  select count(*),count(*) filter(where a.currency_code=t.currency_code and t.occurred_at>=a.opening_at
    and case when t.kind='transfer' then abs(e.signed_amount)=t.amount
      else e.signed_amount=case when t.kind='income' then t.amount else -t.amount end end)
    into entry_count,valid_count from finance.transaction_entries e join finance.accounts a on a.user_id=e.user_id and a.id=e.account_id
    where e.user_id=t.user_id and e.transaction_id=t.id;
  if t.kind='transfer' then
    if entry_count<>2 or valid_count<>2 or (select sum(signed_amount) from finance.transaction_entries where user_id=t.user_id and transaction_id=t.id)<>0 then raise check_violation; end if;
  elsif entry_count<>1 or valid_count<>1 or not exists(select 1 from finance.categories where user_id=t.user_id and id=t.category_id and kind=t.kind) then raise check_violation;
  end if;
  if t.replaces_transaction_id is not null and not exists(select 1 from finance.transactions old
    where old.user_id=t.user_id and old.id=t.replaces_transaction_id and old.status='void' and old.version=t.replaces_version+1
      and old.void_reason=t.replacement_reason and old.recorded_at<=t.recorded_at) then raise check_violation; end if;
  return null;
end $$;
revoke all on function finance.guard_transaction(),finance.check_transaction_entries() from public,anon,authenticated;

-- All commands serialize on the verified owner's profile before touching accounts.
-- The replacement subtracts the original effect and applies the new effect together.
create function finance.write_movement(p_request_id uuid,p_kind text,p_account_id uuid,p_destination_id uuid,p_category_id uuid,
  p_amount text,p_description text,p_note text,p_occurred_at timestamptz,p_replaces_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owned uuid; existing finance.transactions%rowtype; previous finance.transactions%rowtype;
  account finance.accounts%rowtype; destination finance.accounts%rowtype; category finance.categories%rowtype;
  amount numeric; target uuid; moment timestamptz; affected record; balance numeric; effect numeric;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_request_id is null or p_kind is null or p_kind not in ('income','expense','transfer') or p_account_id is null
    or (p_kind='transfer' and (p_destination_id is null or p_destination_id=p_account_id or p_category_id is not null))
    or (p_kind<>'transfer' and (p_category_id is null or p_destination_id is not null))
    or p_amount is null or p_amount !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$'
    or p_description is null or length(btrim(p_description)) not between 1 and 200 or p_note is null or length(btrim(p_note))>2000
    or (p_replaces_id is not null and (p_expected_version is null or p_expected_version<1 or p_reason is null or length(btrim(p_reason)) not between 1 and 300))
    or (p_replaces_id is null and (p_expected_version is not null or p_reason is not null)) then raise check_violation; end if;
  amount:=p_amount::numeric; if amount<=0 then raise check_violation; end if;
  select * into existing from finance.transactions where user_id=owned and create_request_id=p_request_id;
  if found then
    if existing.kind=p_kind and existing.category_id is not distinct from p_category_id and existing.amount=amount
      and existing.description=btrim(p_description) and existing.note=btrim(p_note) and existing.requested_occurred_at is not distinct from p_occurred_at
      and existing.replaces_transaction_id is not distinct from p_replaces_id and existing.replaces_version is not distinct from p_expected_version
      and existing.replacement_reason is not distinct from btrim(p_reason)
      and exists(select 1 from finance.transaction_entries where user_id=owned and transaction_id=existing.id and account_id=p_account_id
        and signed_amount=case when p_kind='income' then amount else -amount end)
      and (p_kind<>'transfer' or exists(select 1 from finance.transaction_entries where user_id=owned and transaction_id=existing.id and account_id=p_destination_id and signed_amount=amount)) then
      return jsonb_build_object('id',existing.id,'status',existing.status);
    end if;
    raise serialization_failure;
  end if;
  if (select count(*) from finance.transactions where user_id=owned)>=10000 then raise program_limit_exceeded; end if;
  if p_replaces_id is not null then
    select * into previous from finance.transactions where user_id=owned and id=p_replaces_id for update;
    if not found then raise no_data_found; end if;
    if previous.status<>'posted' or previous.version<>p_expected_version then raise serialization_failure; end if;
  end if;
  -- A stable lock order covers original and replacement accounts, including archived originals.
  perform 1 from finance.accounts a where a.user_id=owned and (a.id in (p_account_id,p_destination_id)
    or a.id in (select e.account_id from finance.transaction_entries e where e.user_id=owned and e.transaction_id=p_replaces_id)) order by a.id for update;
  select * into account from finance.accounts where user_id=owned and id=p_account_id;
  if not found then raise no_data_found; end if;
  if account.status<>'active' then raise check_violation; end if;
  if p_kind='transfer' then
    select * into destination from finance.accounts where user_id=owned and id=p_destination_id;
    if not found then raise no_data_found; end if;
    if destination.status<>'active' or destination.currency_code<>account.currency_code then raise check_violation; end if;
  else
    select * into category from finance.categories where user_id=owned and id=p_category_id for update;
    if not found then raise no_data_found; end if;
    if category.status<>'active' or category.kind<>p_kind then raise check_violation; end if;
    if category.parent_id is not null then
      perform 1 from finance.categories where user_id=owned and id=category.parent_id and status='active' for update;
      if not found then raise check_violation; end if;
    end if;
  end if;
  moment:=coalesce(p_occurred_at,clock_timestamp());
  if not isfinite(moment) or moment<account.opening_at or (p_kind='transfer' and moment<destination.opening_at) or moment>clock_timestamp() then raise datetime_field_overflow; end if;
  for affected in select a.id,a.opening_balance from finance.accounts a where a.user_id=owned and (a.id in (p_account_id,p_destination_id)
    or a.id in (select e.account_id from finance.transaction_entries e where e.user_id=owned and e.transaction_id=p_replaces_id)) loop
    select affected.opening_balance+coalesce(sum(e.signed_amount),0) into balance from finance.transaction_entries e
      join finance.transactions t on t.user_id=e.user_id and t.id=e.transaction_id
      where e.user_id=owned and e.account_id=affected.id and t.status='posted' and (p_replaces_id is null or t.id<>p_replaces_id);
    effect:=case when affected.id=p_account_id then case when p_kind='income' then amount else -amount end when affected.id=p_destination_id then amount else 0 end;
    if abs(balance+effect)>9999999999999999.99 then raise numeric_value_out_of_range; end if;
  end loop;
  if p_replaces_id is not null then
    update finance.transactions set status='void',version=version+1,voided_at=clock_timestamp(),void_reason=btrim(p_reason) where user_id=owned and id=p_replaces_id;
    insert into finance.transaction_events(user_id,transaction_id,action,version) values(owned,p_replaces_id,'replaced',previous.version+1);
  end if;
  insert into finance.transactions(user_id,create_request_id,kind,description,note,amount,currency_code,category_id,requested_occurred_at,occurred_at,replaces_transaction_id,replaces_version,replacement_reason)
    values(owned,p_request_id,p_kind,btrim(p_description),btrim(p_note),amount,account.currency_code,p_category_id,p_occurred_at,moment,p_replaces_id,p_expected_version,btrim(p_reason)) returning id into target;
  insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) values(owned,target,account.id,case when p_kind='income' then amount else -amount end);
  if p_kind='transfer' then insert into finance.transaction_entries(user_id,transaction_id,account_id,signed_amount) values(owned,target,destination.id,amount); end if;
  insert into finance.transaction_events(user_id,transaction_id,action,version) values(owned,target,'posted',1);
  return jsonb_build_object('id',target,'status','posted');
end $$;
revoke all on function finance.write_movement(uuid,text,uuid,uuid,uuid,text,text,text,timestamptz,uuid,integer,text) from public,anon,authenticated;
grant execute on function finance.write_movement(uuid,text,uuid,uuid,uuid,text,text,text,timestamptz,uuid,integer,text) to app_executor;

create or replace function api.post_movement(p_request_id uuid,p_kind text,p_account_id uuid,p_category_id uuid,p_amount text,p_description text,p_note text,p_occurred_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_kind is null or p_kind not in ('income','expense') then raise check_violation; end if;
  return finance.write_movement(p_request_id,p_kind,p_account_id,null,p_category_id,p_amount,p_description,p_note,p_occurred_at,null,null,null);
end $$;
create function api.post_transfer(p_request_id uuid,p_account_id uuid,p_destination_id uuid,p_amount text,p_description text,p_note text,p_occurred_at timestamptz default null)
returns jsonb language sql security definer set search_path='' as $$
  select finance.write_movement(p_request_id,'transfer',p_account_id,p_destination_id,null,p_amount,p_description,p_note,p_occurred_at,null,null,null);
$$;
create function api.replace_movement(p_request_id uuid,p_id uuid,p_expected_version integer,p_reason text,p_kind text,p_account_id uuid,p_destination_id uuid,p_category_id uuid,p_amount text,p_description text,p_note text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_id is null then raise check_violation; end if;
  return finance.write_movement(p_request_id,p_kind,p_account_id,p_destination_id,p_category_id,p_amount,p_description,p_note,p_occurred_at,p_id,p_expected_version,p_reason);
end $$;

create or replace function api.void_movement(p_id uuid,p_expected_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owned uuid; existing finance.transactions%rowtype; affected record; balance numeric;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_id is null or p_expected_version is null or p_expected_version<1 or p_reason is null or length(btrim(p_reason)) not between 1 and 300 then raise check_violation; end if;
  select * into existing from finance.transactions where user_id=owned and id=p_id for update;
  if not found then raise no_data_found; end if;
  if existing.status='void' then return jsonb_build_object('id',existing.id,'status','void'); end if;
  if existing.version<>p_expected_version then raise serialization_failure; end if;
  for affected in select a.id,a.opening_balance from finance.accounts a where a.user_id=owned and a.id in
    (select e.account_id from finance.transaction_entries e where e.user_id=owned and e.transaction_id=p_id) order by a.id for update loop
    select affected.opening_balance+coalesce(sum(e.signed_amount),0) into balance from finance.transaction_entries e
      join finance.transactions t on t.user_id=e.user_id and t.id=e.transaction_id
      where e.user_id=owned and e.account_id=affected.id and t.status='posted' and t.id<>p_id;
    if abs(balance)>9999999999999999.99 then raise numeric_value_out_of_range; end if;
  end loop;
  update finance.transactions set status='void',version=version+1,voided_at=clock_timestamp(),void_reason=btrim(p_reason) where user_id=owned and id=p_id;
  insert into finance.transaction_events(user_id,transaction_id,action,version) values(owned,p_id,'voided',existing.version+1);
  return jsonb_build_object('id',p_id,'status','void');
end $$;

-- One row per operation. A transfer is selected through its outgoing entry;
-- filtering either account must never duplicate a row or turn it into income/expense.
create view finance.movement_details with(security_invoker=true) as
select t.id,t.user_id,t.kind,t.description,t.note,(t.amount*100)::numeric(20,0)::text as amount_minor,t.currency_code,
  e.account_id,a.name as account_name,d.account_id as destination_id,da.name as destination_name,
  t.category_id,c.name as category_name,p.name as parent_name,t.occurred_at,t.status,t.version,t.void_reason,t.recorded_at,t.voided_at,
  t.replaces_transaction_id as replaces_id,t.replacement_reason,successor.id as replaced_by_id
from finance.transactions t
join finance.transaction_entries e on e.user_id=t.user_id and e.transaction_id=t.id and (t.kind<>'transfer' or e.signed_amount<0)
join finance.accounts a on a.user_id=e.user_id and a.id=e.account_id
left join finance.transaction_entries d on d.user_id=t.user_id and d.transaction_id=t.id and t.kind='transfer' and d.signed_amount>0
left join finance.accounts da on da.user_id=d.user_id and da.id=d.account_id
left join finance.categories c on c.user_id=t.user_id and c.id=t.category_id
left join finance.categories p on p.user_id=c.user_id and p.id=c.parent_id
left join finance.transactions successor on successor.user_id=t.user_id and successor.replaces_transaction_id=t.id;
revoke all on finance.movement_details from public,anon,authenticated;
grant select on finance.movement_details to app_executor;

create or replace function api.read_movements(p_currency text default 'PEN',p_kind text default null,p_account_id uuid default null,p_category_id uuid default null,
  p_from date default null,p_to date default null,p_query text default '',p_cursor_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 25,p_status text default 'all')
returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; zone text;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  select timezone into zone from finance.profiles where user_id=owned and onboarding_completed_at is not null;
  if not found then raise insufficient_privilege; end if;
  if p_currency is null or p_currency not in ('PEN','USD') or (p_kind is not null and p_kind not in ('income','expense','transfer'))
    or p_query is null or length(p_query)>200 or p_limit is null or p_limit not between 1 and 50
    or (p_cursor_at is null)<>(p_cursor_id is null) or (p_cursor_at is not null and not isfinite(p_cursor_at))
    or (p_from is not null and not isfinite(p_from)) or (p_to is not null and not isfinite(p_to))
    or (p_from is not null and p_to is not null and p_from>p_to) or p_status is null or p_status not in ('all','posted','void','replaced') then raise check_violation; end if;
  return(with filtered as materialized(
    select m.* from finance.movement_details m where m.user_id=owned and m.currency_code=p_currency and (p_kind is null or m.kind=p_kind)
      and (p_status='all' or (p_status='replaced' and m.replaced_by_id is not null) or (p_status<>'replaced' and m.status=p_status))
      and (p_account_id is null or m.account_id=p_account_id or m.destination_id=p_account_id)
      and (p_category_id is null or m.category_id=p_category_id or exists(select 1 from finance.categories c where c.user_id=owned and c.id=m.category_id and c.parent_id=p_category_id))
      and (p_from is null or m.occurred_at>=(p_from::timestamp at time zone zone))
      and (p_to is null or m.occurred_at<((p_to+1)::timestamp at time zone zone))
      and (p_query='' or strpos(lower(m.description||' '||m.note),lower(p_query))>0)
  ), page as(select * from filtered where p_cursor_at is null or (occurred_at,id)<(p_cursor_at,p_cursor_id) order by occurred_at desc,id desc limit p_limit+1),
  shown as(select * from page order by occurred_at desc,id desc limit p_limit)
  select jsonb_build_object('currency_code',p_currency,'total_count',(select count(*) from filtered),
    'income_minor',(select coalesce(sum(amount_minor::numeric) filter(where kind='income' and status='posted'),0)::numeric(30,0)::text from filtered),
    'expense_minor',(select coalesce(sum(amount_minor::numeric) filter(where kind='expense' and status='posted'),0)::numeric(30,0)::text from filtered),
    'has_more',(select count(*)>p_limit from page),
    'next_cursor',case when (select count(*)>p_limit from page) then(select jsonb_build_object('at',occurred_at,'id',id) from shown order by occurred_at,id limit 1) else null end,
    'movements',(select coalesce(jsonb_agg(to_jsonb(s)-'user_id' order by occurred_at desc,id desc),'[]'::jsonb) from shown s)));
end $$;
create function api.read_movement(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=finance.request_user_id() and onboarding_completed_at is not null;
  if not found then raise insufficient_privilege; end if;
  select to_jsonb(m)-'user_id' into result from finance.movement_details m where m.user_id=finance.request_user_id() and m.id=p_id;
  if result is null then raise no_data_found; end if;
  return result;
end $$;

grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.post_transfer(uuid,uuid,uuid,text,text,text,timestamptz) owner to app_executor;
alter function api.replace_movement(uuid,uuid,integer,text,text,uuid,uuid,uuid,text,text,text,timestamptz) owner to app_executor;
alter function api.read_movement(uuid) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.post_transfer(uuid,uuid,uuid,text,text,text,timestamptz),api.replace_movement(uuid,uuid,integer,text,text,uuid,uuid,uuid,text,text,text,timestamptz),api.read_movement(uuid) from public,anon,authenticated;
grant execute on function api.post_transfer(uuid,uuid,uuid,text,text,text,timestamptz),api.replace_movement(uuid,uuid,integer,text,text,uuid,uuid,uuid,text,text,text,timestamptz),api.read_movement(uuid) to authenticated;
revoke app_executor from postgres;
