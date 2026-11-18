-- Permanent business conflicts must not trigger PostgREST 14 serialization retries.
-- Only the two explicit business RAISE sites change; engine 40001 propagates unchanged.
begin;
create or replace function finance.write_movement(p_request_id uuid,p_kind text,p_account_id uuid,p_destination_id uuid,p_category_id uuid,
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
    raise sqlstate 'PT409' using message = 'idempotency_conflict';
  end if;
  if (select count(*) from finance.transactions where user_id=owned)>=10000 then raise program_limit_exceeded; end if;
  if p_replaces_id is not null then
    select * into previous from finance.transactions where user_id=owned and id=p_replaces_id for update;
    if not found then raise no_data_found; end if;
    if previous.status<>'posted' or previous.version<>p_expected_version then raise sqlstate 'PT409' using message = 'movement_version_conflict'; end if;
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
commit;
