-- User-authorized removal from the normal history, with immutable ledger trace.
-- The separate tombstone leaves financial versions and replacement chains intact.
grant app_executor to postgres;
grant create on schema api to app_executor;

create table finance.movement_deletions (
  user_id uuid not null references finance.profiles(user_id) on delete cascade,
  transaction_id uuid not null,
  transaction_version integer not null check(transaction_version > 0),
  reason text not null check(length(btrim(reason)) between 1 and 300),
  deleted_at timestamptz not null default clock_timestamp(),
  primary key(user_id,transaction_id),
  foreign key(user_id,transaction_id) references finance.transactions(user_id,id) on delete cascade
);
alter table finance.movement_deletions enable row level security;
alter table finance.movement_deletions force row level security;
revoke all on finance.movement_deletions from public,anon,authenticated;
grant select,insert on finance.movement_deletions to app_executor;
create policy movement_deletions_read on finance.movement_deletions for select to app_executor
  using(user_id=(select finance.request_user_id()));
create policy movement_deletions_insert on finance.movement_deletions for insert to app_executor
  with check(user_id=(select finance.request_user_id()) and exists(
    select 1 from finance.transactions t where t.user_id=movement_deletions.user_id
      and t.id=movement_deletions.transaction_id and t.status='void' and t.version=movement_deletions.transaction_version));
grant select,delete on finance.movement_deletions to finzi_deletion_worker;
create policy movement_deletions_cleanup_read on finance.movement_deletions for select to finzi_deletion_worker
  using(exists(select 1 from ops.deletion_subjects s where s.user_id=movement_deletions.user_id));
create policy movement_deletions_cleanup_delete on finance.movement_deletions for delete to finzi_deletion_worker
  using(exists(select 1 from ops.deletion_subjects s where s.user_id=movement_deletions.user_id));

create function api.delete_movement(p_id uuid,p_expected_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owned uuid; existing finance.transactions%rowtype; removed finance.movement_deletions%rowtype;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_id is null or p_expected_version is null or p_expected_version<1 or p_reason is null
    or length(btrim(p_reason)) not between 1 and 300 then raise check_violation; end if;
  select * into existing from finance.transactions where user_id=owned and id=p_id for update;
  if not found then raise no_data_found; end if;
  select * into removed from finance.movement_deletions where user_id=owned and transaction_id=p_id;
  if found then return jsonb_build_object('id',p_id,'status','void','deleted_at',removed.deleted_at); end if;
  if existing.version<>p_expected_version then raise serialization_failure; end if;
  -- Reuses the same account locks, range checks and atomic two-entry cancellation.
  if existing.status='posted' then perform api.void_movement(p_id,p_expected_version,p_reason); end if;
  insert into finance.movement_deletions(user_id,transaction_id,transaction_version,reason)
    select owned,p_id,version,btrim(p_reason) from finance.transactions where user_id=owned and id=p_id
    returning * into removed;
  return jsonb_build_object('id',p_id,'status','void','deleted_at',removed.deleted_at);
end $$;
alter function api.delete_movement(uuid,integer,text) owner to app_executor;
revoke all on function api.delete_movement(uuid,integer,text) from public,anon,authenticated;
grant execute on function api.delete_movement(uuid,integer,text) to authenticated;
revoke create on schema api from app_executor;
revoke app_executor from postgres;

-- Detail and full JSON export retain the deletion; list and pagination exclude it.
create or replace view finance.movement_details with(security_invoker=true) as
select t.id,t.user_id,t.kind,t.description,t.note,(t.amount*100)::numeric(20,0)::text as amount_minor,t.currency_code,
  e.account_id,case when a.status='deleted' then 'Cuenta eliminada' else a.name end as account_name,
  d.account_id as destination_id,case when da.status='deleted' then 'Cuenta eliminada' else da.name end as destination_name,
  t.category_id,c.name as category_name,p.name as parent_name,t.occurred_at,t.status,t.version,t.void_reason,t.recorded_at,t.voided_at,
  t.replaces_transaction_id as replaces_id,t.replacement_reason,successor.id as replaced_by_id,removed.deleted_at,removed.reason as deletion_reason
from finance.transactions t
join finance.transaction_entries e on e.user_id=t.user_id and e.transaction_id=t.id and (t.kind<>'transfer' or e.signed_amount<0)
join finance.accounts a on a.user_id=e.user_id and a.id=e.account_id
left join finance.transaction_entries d on d.user_id=t.user_id and d.transaction_id=t.id and t.kind='transfer' and d.signed_amount>0
left join finance.accounts da on da.user_id=d.user_id and da.id=d.account_id
left join finance.categories c on c.user_id=t.user_id and c.id=t.category_id
left join finance.categories p on p.user_id=c.user_id and p.id=c.parent_id
left join finance.transactions successor on successor.user_id=t.user_id and successor.replaces_transaction_id=t.id
left join finance.movement_deletions removed on removed.user_id=t.user_id and removed.transaction_id=t.id;
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
    select m.* from finance.movement_details m where m.user_id=owned and m.deleted_at is null and m.currency_code=p_currency and (p_kind is null or m.kind=p_kind)
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
