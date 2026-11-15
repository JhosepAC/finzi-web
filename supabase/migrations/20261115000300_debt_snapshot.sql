grant app_executor to postgres;
-- One statement snapshot for obligations and account balances.
create or replace function api.read_debts() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id();zone text;
begin
 select timezone into zone from finance.profiles where user_id=owned and onboarding_completed_at is not null;if not found then raise insufficient_privilege;end if;
 return jsonb_build_object('accounts',api.read_accounts(),'today',(statement_timestamp() at time zone zone)::date,'debts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from(select d.id,d.name,d.detail,d.creditor,d.icon,d.category,d.currency_code,(d.amount*100)::numeric(20,0)::text as amount_minor,d.due_date,d.version,d.deleted_at,d.created_at,
 (coalesce((select sum(paid_amount) from finance.debt_payment_details p where p.user_id=d.user_id and p.debt_id=d.id),0)*100)::numeric(20,0)::text as paid_minor,
 (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'origin_id',p.origin_id,'effective_id',p.effective_id,'amount_minor',(p.recorded_amount*100)::numeric(20,0)::text,'active',p.paid_amount>0,'created_expense',p.created_expense,'note',p.note,'occurred_at',p.occurred_at,'description',p.description) order by p.recorded_at desc),'[]') from finance.debt_payment_details p where p.user_id=d.user_id and p.debt_id=d.id) as payments
 from finance.debts d where d.user_id=owned) x));
end $$;

alter table finance.debts add constraint debt_due_supported_year check(due_date is null or due_date <= date '9999-12-31');
create index debt_payments_owner_debt on finance.debt_payments(user_id,debt_id);
create index debt_events_owner_debt on finance.debt_events(user_id,debt_id);

revoke app_executor from postgres;
