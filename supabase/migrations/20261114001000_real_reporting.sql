-- A-08: read-only, snapshot-consistent reporting. No new tables or write privileges.
create function api.read_overview(p_currency text default 'PEN',p_period text default 'month',p_anchor date default null,
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
  if p_account_id is not null and not exists(select 1 from finance.accounts where user_id=owned and id=p_account_id and currency_code=p_currency) then raise no_data_found; end if;
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
    select a.* from finance.accounts a where a.user_id=owned and a.currency_code=p_currency and (p_account_id is null or a.id=p_account_id)
  ), live_entries as materialized(
    select e.account_id,e.signed_amount,t.occurred_at from finance.transaction_entries e
      join finance.transactions t on t.user_id=e.user_id and t.id=e.transaction_id join selected a on a.user_id=e.user_id and a.id=e.account_id
      where e.user_id=owned and t.status='posted' and t.occurred_at<=captured
  ), current_accounts as materialized(
    select a.id,a.name,a.status,((a.opening_balance+coalesce((select sum(e.signed_amount) from live_entries e where e.account_id=a.id),0))*100)::numeric(20,0)::text as balance_minor
      from selected a
  ), operations as materialized(
    select m.* from finance.movement_details m where m.user_id=owned and m.currency_code=p_currency and m.status='posted' and m.occurred_at<=captured
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
grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.read_overview(text,text,date,date,date,uuid) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.read_overview(text,text,date,date,date,uuid) from public,anon,authenticated;
grant execute on function api.read_overview(text,text,date,date,date,uuid) to authenticated;
revoke app_executor from postgres;
