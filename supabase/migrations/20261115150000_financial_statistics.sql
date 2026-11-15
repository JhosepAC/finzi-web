-- A-12: read-only statistics from the live ledger, in one statement snapshot.
create function api.read_statistics(
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
grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.read_statistics(text,text,date,date) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.read_statistics(text,text,date,date) from public,anon,authenticated;
grant execute on function api.read_statistics(text,text,date,date) to authenticated;
revoke app_executor from postgres;
