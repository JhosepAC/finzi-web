-- Avoid the trigger implicit OLD row when checking the predecessor.
grant app_executor to postgres;
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
  if t.replaces_transaction_id is not null and not exists(select 1 from finance.transactions predecessor
    where predecessor.user_id=t.user_id and predecessor.id=t.replaces_transaction_id and predecessor.status='void' and predecessor.version=t.replaces_version+1
      and predecessor.void_reason=t.replacement_reason and predecessor.recorded_at<=t.recorded_at) then raise check_violation; end if;
  return null;
end $$;
revoke app_executor from postgres;
