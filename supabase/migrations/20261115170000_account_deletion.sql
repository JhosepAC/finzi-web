-- Account deletion: a tombstone status keeps the ledger and its history intact.
-- A deleted account leaves balances, summaries and selectors; its movements stay
-- immutable in the history and are labelled "Cuenta eliminada". No rows are erased.
alter table finance.accounts drop constraint accounts_status_check;
alter table finance.accounts add constraint accounts_status_check check (status in ('active', 'archived', 'deleted'));
alter table finance.account_events drop constraint account_events_action_check;
alter table finance.account_events add constraint account_events_action_check check (action in ('created', 'updated', 'archived', 'restored', 'deleted'));

grant app_executor to postgres;
grant create on schema api to app_executor;

-- Live projection: deleted accounts never reach client lists, selectors or exports.
create or replace function api.read_accounts() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'type',a.type,'currency_code',a.currency_code,
    'opening_minor',(a.opening_balance*100)::numeric(20,0)::text,'opening_at',a.opening_at,'status',a.status,'version',a.version,
    'can_edit_opening',not exists(select 1 from finance.transaction_entries h where h.user_id=a.user_id and h.account_id=a.id),
    'balance_minor',((a.opening_balance+coalesce((select sum(e.signed_amount) from finance.transaction_entries e
       join finance.transactions t on t.user_id=e.user_id and t.id=e.transaction_id where e.user_id=a.user_id and e.account_id=a.id
       and t.status='posted' and t.occurred_at<=clock_timestamp()),0))*100)::numeric(20,0)::text) order by a.created_at,a.id),'[]'::jsonb)
    from finance.accounts a where a.user_id=finance.request_user_id() and a.status<>'deleted');
end $$;

create or replace function api.create_account(p_request_id uuid,p_name text,p_type text,p_currency text,p_opening text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing finance.accounts%rowtype; amount numeric; owned uuid; account_id uuid;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_request_id is null or p_name is null or length(btrim(p_name)) not between 1 and 100
    or p_type is null or p_type not in ('cash','bank','savings','custom')
    or p_currency is null or p_currency not in ('PEN','USD')
    or p_opening is null or p_opening !~ '^-?[0-9]{1,16}(\.[0-9]{1,2})?$' then raise check_violation; end if;
  amount:=p_opening::numeric;
  select * into existing from finance.accounts where user_id=owned and create_request_id=p_request_id for update;
  if found then
    -- A deleted account keeps its idempotency key; reusing it is a conflict, not a resurrection.
    if existing.status='deleted' then raise serialization_failure; end if;
    if existing.name=btrim(p_name) and existing.type=p_type and existing.currency_code=p_currency and existing.opening_balance=amount then
      return(select value from jsonb_array_elements(api.read_accounts()) where value->>'id'=existing.id::text);
    end if;
    raise serialization_failure;
  end if;
  if (select count(*) from finance.accounts where user_id=owned and status<>'deleted')>=100 then raise program_limit_exceeded; end if;
  insert into finance.accounts(user_id,create_request_id,name,type,currency_code,opening_balance)
    values(owned,p_request_id,btrim(p_name),p_type,p_currency,amount) returning id into account_id;
  insert into finance.account_events(user_id,account_id,action,version) values(owned,account_id,'created',1);
  return(select value from jsonb_array_elements(api.read_accounts()) where value->>'id'=account_id::text);
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
  if not found or existing.status='deleted' then raise no_data_found; end if;
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

create function api.delete_account(p_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing finance.accounts%rowtype; owned uuid;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_id is null or p_expected_version is null or p_expected_version<1 then raise check_violation; end if;
  select * into existing from finance.accounts where user_id=owned and id=p_id for update;
  if not found then raise no_data_found; end if;
  if existing.status='deleted' then return api.read_accounts(); end if;
  if existing.version<>p_expected_version then raise serialization_failure; end if;
  update finance.accounts set status='deleted',version=version+1,updated_at=now() where user_id=owned and id=p_id;
  insert into finance.account_events(user_id,account_id,action,version) values(owned,p_id,'deleted',existing.version+1);
  return api.read_accounts();
end $$;

-- History keeps every row; a deleted account is named instead of disappearing.
create or replace view finance.movement_details with(security_invoker=true) as
select t.id,t.user_id,t.kind,t.description,t.note,(t.amount*100)::numeric(20,0)::text as amount_minor,t.currency_code,
  e.account_id,case when a.status='deleted' then 'Cuenta eliminada' else a.name end as account_name,
  d.account_id as destination_id,case when da.status='deleted' then 'Cuenta eliminada' else da.name end as destination_name,
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

-- Deleted accounts stop contributing to current balances and cannot be selected.
create or replace function api.read_overview(p_currency text default 'PEN',p_period text default 'month',p_anchor date default null,
  p_from date default null,p_to date default null,p_account_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owned uuid; zone text; today date; anchor_day date; first_day date; last_day date; previous_first date; previous_last date;
  captured timestamptz:=statement_timestamp(); granularity text;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  select timezone into zone from finance.profiles where user_id=owned and onboarding_completed_at is not null;
  if not found then raise insufficient_privilege; end if;
  today:=(captured at time zone zone)::date; anchor_day:=coalesce(p_anchor,today);
  if p_currency is null or p_currency not in ('PEN','USD') or p_period is null or p_period not in ('day','week','month','quarter','year','custom')
    or not isfinite(anchor_day) or anchor_day<date '1900-01-01' or anchor_day>today then raise check_violation; end if;
  if p_account_id is not null and not exists(select 1 from finance.accounts where user_id=owned and id=p_account_id and currency_code=p_currency and status<>'deleted') then raise no_data_found; end if;
  if p_period='custom' then
    if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from<date '1900-01-01'
      or p_to<p_from or p_to-p_from>3659 or p_to>today or p_anchor is not null then raise check_violation; end if;
    first_day:=p_from; last_day:=p_to; previous_last:=first_day-1; previous_first:=first_day-(last_day-first_day+1);
  else
    if p_from is not null or p_to is not null then raise check_violation; end if;
    first_day:=date_trunc(p_period,anchor_day::timestamp)::date;
    last_day:=(first_day::timestamp+case p_period when 'day' then interval '1 day' when 'week' then interval '1 week'
      when 'month' then interval '1 month' when 'quarter' then interval '3 months' else interval '1 year' end)::date-1;
    previous_last:=first_day-1;
    previous_first:=date_trunc(p_period,previous_last::timestamp)::date;
  end if;
  granularity:=case when last_day-first_day<=92 then 'day' else 'month' end;
  return(with selected as materialized(
    select a.* from finance.accounts a where a.user_id=owned and a.currency_code=p_currency and a.status<>'deleted' and (p_account_id is null or a.id=p_account_id)
  ), live_entries as materialized(
    select e.account_id,e.signed_amount,t.occurred_at from finance.transaction_entries e
      join finance.transactions t on t.user_id=e.user_id and t.id=e.transaction_id join selected a on a.user_id=e.user_id and a.id=e.account_id
      where e.user_id=owned and t.status='posted' and t.occurred_at<=captured
  ), current_accounts as materialized(
    select a.id,a.name,a.status,((a.opening_balance+coalesce((select sum(e.signed_amount) from live_entries e where e.account_id=a.id),0))*100)::numeric(20,0)::text as balance_minor
      from selected a
  ), live_accounts as materialized(
    select a.id from finance.accounts a where a.user_id=owned and a.currency_code=p_currency and a.status<>'deleted'
  ), operations as materialized(
    select m.* from finance.movement_details m where m.user_id=owned and m.currency_code=p_currency and m.status='posted' and m.occurred_at<=captured
      and m.account_id in (select id from live_accounts) and (m.destination_id is null or m.destination_id in (select id from live_accounts))
      and (p_account_id is null or m.account_id=p_account_id or m.destination_id=p_account_id)
      and m.occurred_at>=(previous_first::timestamp at time zone zone) and m.occurred_at<((last_day+1)::timestamp at time zone zone)
  ), current_ops as materialized(
    select m.* from operations m where m.occurred_at>=(first_day::timestamp at time zone zone)
  ), previous_ops as materialized(
    select m.* from operations m where m.occurred_at<((previous_last+1)::timestamp at time zone zone)
  ), buckets as(
    select greatest(first_day,g.d::date) as start_day,least(last_day,today,(g.d+case when granularity='day' then interval '1 day' else interval '1 month' end)::date-1) as end_day
    from generate_series(date_trunc(granularity,first_day::timestamp),date_trunc(granularity,least(last_day,today)::timestamp),case when granularity='day' then interval '1 day' else interval '1 month' end) g(d)
  ), series as(
    select b.start_day,b.end_day,
      case when exists(select 1 from selected a where a.opening_at<least(captured,((b.end_day+1)::timestamp at time zone zone))) then
        ((coalesce((select sum(a.opening_balance) from selected a where a.opening_at<least(captured,((b.end_day+1)::timestamp at time zone zone))),0)
          +coalesce((select sum(e.signed_amount) from live_entries e where e.occurred_at<least(captured,((b.end_day+1)::timestamp at time zone zone))),0))*100)::numeric(30,0)::text else null end as balance_minor,
      coalesce((select sum(m.amount_minor::numeric) from current_ops m where m.kind='income' and m.occurred_at>=(b.start_day::timestamp at time zone zone) and m.occurred_at<((b.end_day+1)::timestamp at time zone zone)),0)::numeric(30,0)::text as income_minor,
      coalesce((select sum(m.amount_minor::numeric) from current_ops m where m.kind='expense' and m.occurred_at>=(b.start_day::timestamp at time zone zone) and m.occurred_at<((b.end_day+1)::timestamp at time zone zone)),0)::numeric(30,0)::text as expense_minor
    from buckets b
  ), category_totals as materialized(
    select m.kind,c.id,c.parent_id,c.name,c.color,sum(m.amount_minor::numeric) as minor from current_ops m
      join finance.categories c on c.user_id=m.user_id and c.id=m.category_id where m.kind in ('income','expense') group by m.kind,c.id,c.parent_id,c.name,c.color
  ), roots as(
    select c.kind,coalesce(c.parent_id,c.id) as id,sum(c.minor) as minor from category_totals c group by c.kind,coalesce(c.parent_id,c.id)
  )
  select jsonb_build_object('currency_code',p_currency,'timezone',zone,'as_of',captured,'account_id',p_account_id,
    'from',first_day,'to',last_day,'previous_from',previous_first,'previous_to',previous_last,'partial',last_day>=today,'granularity',granularity,
    'balance_minor',(select coalesce(sum(balance_minor::numeric),0)::numeric(30,0)::text from current_accounts),
    'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.name,a.id),'[]'::jsonb) from current_accounts a),
    'movement_count',(select count(*) from current_ops),
    'income_minor',(select coalesce(sum(amount_minor::numeric) filter(where kind='income'),0)::numeric(30,0)::text from current_ops),
    'expense_minor',(select coalesce(sum(amount_minor::numeric) filter(where kind='expense'),0)::numeric(30,0)::text from current_ops),
    'previous_income_minor',(select coalesce(sum(amount_minor::numeric) filter(where kind='income'),0)::numeric(30,0)::text from previous_ops),
    'previous_expense_minor',(select coalesce(sum(amount_minor::numeric) filter(where kind='expense'),0)::numeric(30,0)::text from previous_ops),
    'series',(select coalesce(jsonb_agg(jsonb_build_object('from',s.start_day,'to',s.end_day,'balance_minor',s.balance_minor,'income_minor',s.income_minor,'expense_minor',s.expense_minor) order by s.start_day),'[]'::jsonb) from series s),
    'categories',(select coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'category_id',r.id,'name',c.name,'color',c.color,'amount_minor',r.minor::numeric(30,0)::text,
      'children',(select coalesce(jsonb_agg(jsonb_build_object('category_id',k.id,'name',k.name,'amount_minor',k.minor::numeric(30,0)::text) order by k.minor desc,k.id),'[]'::jsonb) from category_totals k where k.kind=r.kind and (k.parent_id=r.id or k.id=r.id))) order by r.minor desc,r.id),'[]'::jsonb)
      from roots r join finance.categories c on c.user_id=owned and c.id=r.id),
    'recent',(select coalesce(jsonb_agg(to_jsonb(m)-'user_id' order by m.occurred_at desc,m.id desc),'[]'::jsonb) from(select * from current_ops order by occurred_at desc,id desc limit 5) m)
  ));
end $$;

-- Statistics read the same live accounts as Inicio: a deleted account stops counting.
create or replace function api.read_statistics(
  p_currency text default 'PEN', p_period text default 'month',
  p_from date default null, p_to date default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owned uuid := finance.request_user_id(); zone text;
  captured timestamptz := statement_timestamp(); today date;
  first_day date; last_day date; previous_first date; previous_last date;
  grain text; step interval;
begin
  select timezone into zone from finance.profiles
    where user_id = owned and onboarding_completed_at is not null;
  if not found then raise insufficient_privilege; end if;
  today := (captured at time zone zone)::date;
  if p_currency is null or p_currency not in ('PEN','USD') or p_period is null
    or p_period not in ('week','month','three_months','six_months','year','custom')
    then raise check_violation; end if;
  last_day := today;
  if p_period = 'custom' then
    if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
      or p_from < date '1900-01-01' or p_to < p_from or p_to > today
      or p_to - p_from > 3659 then raise check_violation; end if;
    first_day := p_from; last_day := p_to;
  else
    if p_from is not null or p_to is not null then raise check_violation; end if;
    first_day := case p_period
      when 'week' then date_trunc('week',today::timestamp)::date
      when 'month' then date_trunc('month',today::timestamp)::date
      when 'three_months' then (date_trunc('month',today::timestamp)-interval '2 months')::date
      when 'six_months' then (date_trunc('month',today::timestamp)-interval '5 months')::date
      else date_trunc('year',today::timestamp)::date end;
  end if;
  previous_last := first_day - 1;
  previous_first := first_day - (last_day - first_day + 1);
  grain := case when p_period in ('three_months','six_months','year') or last_day-first_day > 92 then 'month'
    when last_day-first_day > 30 then 'week' else 'day' end;
  step := case grain when 'day' then interval '1 day' when 'week' then interval '7 days' else interval '1 month' end;
  return (
    with operations as materialized (
      select t.category_id,t.kind,t.amount*100 as minor,(t.occurred_at at time zone zone)::date as day
      from finance.transactions t
      where t.user_id=owned and t.currency_code=p_currency and t.status='posted'
        and t.kind in ('income','expense') and t.occurred_at<=captured
        and t.occurred_at >= (previous_first::timestamp at time zone zone)
        and t.occurred_at < ((last_day+1)::timestamp at time zone zone)
        and not exists(select 1 from finance.transaction_entries e
          join finance.accounts a on a.user_id=e.user_id and a.id=e.account_id
          where e.user_id=t.user_id and e.transaction_id=t.id and a.status='deleted')
    ), totals as (
      select coalesce(sum(minor) filter(where kind='income' and day>=first_day),0) as income,
        coalesce(sum(minor) filter(where kind='expense' and day>=first_day),0) as expense,
        coalesce(sum(minor) filter(where kind='income' and day<first_day),0) as previous_income,
        coalesce(sum(minor) filter(where kind='expense' and day<first_day),0) as previous_expense,
        count(*) filter(where day>=first_day) as count,
        count(*) filter(where day<first_day) as previous_count
      from operations
    ), buckets as (
      select greatest(first_day,g.d::date) as start_day,
        least(last_day,(g.d+step)::date-1) as end_day
      from generate_series(
        case when grain='month' then date_trunc('month',first_day::timestamp) else first_day::timestamp end,
        last_day::timestamp,step
      ) g(d)
    ), series as (
      select b.start_day,b.end_day,
        previous_first+(b.start_day-first_day) as previous_start,
        previous_first+(b.end_day-first_day) as previous_end,
        coalesce(sum(o.minor) filter(where o.kind='income' and o.day between b.start_day and b.end_day),0) as income,
        coalesce(sum(o.minor) filter(where o.kind='expense' and o.day between b.start_day and b.end_day),0) as expense,
        coalesce(sum(o.minor) filter(where o.kind='income' and o.day between previous_first+(b.start_day-first_day) and previous_first+(b.end_day-first_day)),0) as previous_income,
        coalesce(sum(o.minor) filter(where o.kind='expense' and o.day between previous_first+(b.start_day-first_day) and previous_first+(b.end_day-first_day)),0) as previous_expense
      from buckets b left join operations o on o.day between b.start_day and b.end_day
        or o.day between previous_first+(b.start_day-first_day) and previous_first+(b.end_day-first_day)
      group by b.start_day,b.end_day
    ), category_totals as materialized (
      select c.id,c.parent_id,c.name,c.color,
        coalesce(sum(o.minor) filter(where o.day>=first_day),0) as amount,
        coalesce(sum(o.minor) filter(where o.day<first_day),0) as previous_amount
      from operations o join finance.categories c on c.user_id=owned and c.id=o.category_id
      where o.kind='expense' group by c.id,c.parent_id,c.name,c.color
    ), roots as (
      select coalesce(parent_id,id) as id,sum(amount) as amount,sum(previous_amount) as previous_amount
      from category_totals group by coalesce(parent_id,id)
    )
    select jsonb_build_object(
      'currency_code',p_currency,'period',p_period,'timezone',zone,'as_of',captured,'today',today,
      'from',first_day,'to',last_day,'previous_from',previous_first,'previous_to',previous_last,
      'granularity',grain,'movement_count',v.count,'previous_movement_count',v.previous_count,
      'income_minor',v.income::numeric(30,0)::text,'expense_minor',v.expense::numeric(30,0)::text,
      'previous_income_minor',v.previous_income::numeric(30,0)::text,'previous_expense_minor',v.previous_expense::numeric(30,0)::text,
      'series',(select coalesce(jsonb_agg(jsonb_build_object(
        'from',s.start_day,'to',s.end_day,'previous_from',s.previous_start,'previous_to',s.previous_end,
        'income_minor',s.income::numeric(30,0)::text,'expense_minor',s.expense::numeric(30,0)::text,
        'previous_income_minor',s.previous_income::numeric(30,0)::text,'previous_expense_minor',s.previous_expense::numeric(30,0)::text
      ) order by s.start_day),'[]'::jsonb) from series s),
      'categories',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',r.id,'name',c.name,'color',c.color,'amount_minor',r.amount::numeric(30,0)::text,
        'previous_amount_minor',r.previous_amount::numeric(30,0)::text,
        'children',(select jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,
          'amount_minor',k.amount::numeric(30,0)::text,'previous_amount_minor',k.previous_amount::numeric(30,0)::text
        ) order by k.amount desc,k.id) from category_totals k where k.id=r.id or k.parent_id=r.id)
      ) order by r.amount desc,r.id),'[]'::jsonb) from roots r join finance.categories c on c.user_id=owned and c.id=r.id)
    ) from totals v
  );
end $$;

alter function api.delete_account(uuid,integer) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.delete_account(uuid,integer) from public,anon,authenticated;
grant execute on function api.delete_account(uuid,integer) to authenticated;
revoke app_executor from postgres;
