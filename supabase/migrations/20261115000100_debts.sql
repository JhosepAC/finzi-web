grant app_executor to postgres;
create table finance.debts(id uuid primary key default gen_random_uuid(),user_id uuid not null references finance.profiles(user_id) on delete cascade,request_id uuid not null,request_hash bytea not null,name text not null check(length(btrim(name)) between 1 and 100),detail text not null check(length(detail)<=2000),creditor text not null check(length(btrim(creditor)) between 1 and 150),icon text not null check(icon in ('wallet','home','book','cart','heart','briefcase')),category text check(category in ('personal','services','loans','shopping','education','other')),currency_code text not null check(currency_code in ('PEN','USD')),amount numeric(20,4) not null check(amount>0 and amount<=9999999999999999.99 and amount=trunc(amount,2) and amount not in ('NaN'::numeric,'Infinity'::numeric)),due_date date check(due_date is null or (isfinite(due_date) and due_date>=date '1900-01-01')),version integer not null default 1,deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,id),unique(user_id,request_id));
create table finance.debt_payments(id uuid primary key default gen_random_uuid(),user_id uuid not null references finance.profiles(user_id) on delete cascade,debt_id uuid not null,origin_id uuid not null,request_id uuid not null,request_hash bytea not null,created_expense boolean not null,note text not null check(length(note)<=1000),recorded_at timestamptz not null default now(),unlinked_at timestamptz,foreign key(user_id,debt_id) references finance.debts(user_id,id),foreign key(user_id,origin_id) references finance.transactions(user_id,id),unique(user_id,request_id));
create unique index debt_payment_origin on finance.debt_payments(user_id,origin_id) where unlinked_at is null;
create table finance.debt_events(id uuid primary key default gen_random_uuid(),user_id uuid not null references finance.profiles(user_id) on delete cascade,debt_id uuid not null,action text not null,recorded_at timestamptz not null default now(),foreign key(user_id,debt_id) references finance.debts(user_id,id));
alter table finance.debts enable row level security;alter table finance.debts force row level security;revoke all on finance.debts from public,anon,authenticated;
grant select,insert on finance.debts to app_executor;
create policy debts_read on finance.debts for select to app_executor using(user_id=(select finance.request_user_id()));
create policy debts_insert on finance.debts for insert to app_executor with check(user_id=(select finance.request_user_id()));
grant select,delete on finance.debts to finzi_deletion_worker;
create policy debts_cleanup_read on finance.debts for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=debts.user_id));
create policy debts_cleanup_delete on finance.debts for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=debts.user_id));
alter table finance.debt_payments enable row level security;alter table finance.debt_payments force row level security;revoke all on finance.debt_payments from public,anon,authenticated;
grant select,insert on finance.debt_payments to app_executor;
create policy debt_payments_read on finance.debt_payments for select to app_executor using(user_id=(select finance.request_user_id()));
create policy debt_payments_insert on finance.debt_payments for insert to app_executor with check(user_id=(select finance.request_user_id()));
grant select,delete on finance.debt_payments to finzi_deletion_worker;
create policy debt_payments_cleanup_read on finance.debt_payments for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=debt_payments.user_id));
create policy debt_payments_cleanup_delete on finance.debt_payments for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=debt_payments.user_id));
alter table finance.debt_events enable row level security;alter table finance.debt_events force row level security;revoke all on finance.debt_events from public,anon,authenticated;
grant select,insert on finance.debt_events to app_executor;
create policy debt_events_read on finance.debt_events for select to app_executor using(user_id=(select finance.request_user_id()));
create policy debt_events_insert on finance.debt_events for insert to app_executor with check(user_id=(select finance.request_user_id()));
grant select,delete on finance.debt_events to finzi_deletion_worker;
create policy debt_events_cleanup_read on finance.debt_events for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=debt_events.user_id));
create policy debt_events_cleanup_delete on finance.debt_events for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=debt_events.user_id));
grant update on finance.debts,finance.debt_payments to app_executor;
create policy debts_update on finance.debts for update to app_executor using(user_id=finance.request_user_id()) with check(user_id=finance.request_user_id());
create policy debt_payments_update on finance.debt_payments for update to app_executor using(user_id=finance.request_user_id()) with check(user_id=finance.request_user_id());
create view finance.debt_payment_details with(security_invoker=true) as
with recursive chain as(select p.id as payment_id,p.user_id,t.id,t.kind,t.currency_code,t.amount,t.status,t.occurred_at,t.description from finance.debt_payments p join finance.transactions t on t.user_id=p.user_id and t.id=p.origin_id
 union all select c.payment_id,c.user_id,t.id,t.kind,t.currency_code,t.amount,t.status,t.occurred_at,t.description from chain c join finance.transactions t on t.user_id=c.user_id and t.replaces_transaction_id=c.id)
select p.*,c.id as effective_id,c.kind,c.currency_code,c.status,c.occurred_at,c.description,c.amount as recorded_amount,
 case when p.unlinked_at is null and c.status='posted' then c.amount else 0 end as paid_amount
from finance.debt_payments p join chain c on c.payment_id=p.id and c.user_id=p.user_id where not exists(select 1 from finance.transactions n where n.user_id=c.user_id and n.replaces_transaction_id=c.id);
grant select on finance.debt_payment_details to app_executor;
create function finance.check_debt_payments() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from finance.debt_payments where user_id=new.user_id and unlinked_at is null) then return null;end if;
 if exists(select 1 from finance.debt_payment_details p join finance.debts d on d.user_id=p.user_id and d.id=p.debt_id where p.user_id=new.user_id and p.unlinked_at is null and (p.kind<>'expense' or p.currency_code<>d.currency_code))
 or exists(select 1 from finance.debt_payment_details p join finance.debts d on d.user_id=p.user_id and d.id=p.debt_id where p.user_id=new.user_id group by d.id,d.amount having sum(p.paid_amount)>d.amount)
 or exists(select 1 from finance.debt_payment_details p where p.user_id=new.user_id and p.unlinked_at is null group by effective_id having count(*)>1) then raise check_violation;end if;return null;
end $$;
create constraint trigger debt_payments_valid after insert or update on finance.debt_payments deferrable initially deferred for each row execute function finance.check_debt_payments();
create constraint trigger debt_amount_valid after update on finance.debts deferrable initially deferred for each row execute function finance.check_debt_payments();
create constraint trigger debt_ledger_valid after insert or update on finance.transactions deferrable initially deferred for each row execute function finance.check_debt_payments();
create function api.read_debts() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id();zone text;
begin
 select timezone into zone from finance.profiles where user_id=owned and onboarding_completed_at is not null;if not found then raise insufficient_privilege;end if;
 return jsonb_build_object('today',(statement_timestamp() at time zone zone)::date,'debts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from(select d.id,d.name,d.detail,d.creditor,d.icon,d.category,d.currency_code,(d.amount*100)::numeric(20,0)::text as amount_minor,d.due_date,d.version,d.deleted_at,d.created_at,
 (coalesce((select sum(paid_amount) from finance.debt_payment_details p where p.user_id=d.user_id and p.debt_id=d.id),0)*100)::numeric(20,0)::text as paid_minor,
 (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'origin_id',p.origin_id,'effective_id',p.effective_id,'amount_minor',(p.recorded_amount*100)::numeric(20,0)::text,'active',p.paid_amount>0,'created_expense',p.created_expense,'note',p.note,'occurred_at',p.occurred_at,'description',p.description) order by p.recorded_at desc),'[]') from finance.debt_payment_details p where p.user_id=d.user_id and p.debt_id=d.id) as payments
 from finance.debts d where d.user_id=owned) x));
end $$;
create function api.debt_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id();c jsonb:=p_command;op text:=c->>'action';d finance.debts%rowtype;target uuid;tx uuid;next_amount numeric;hashed bytea:=sha256(convert_to(c::text,'UTF8'));p finance.debt_payments%rowtype;
begin
 perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;if not found then raise insufficient_privilege;end if;
 if op not in ('create','update','delete','pay','unlink','voidpay') or op is null or exists(select 1 from jsonb_object_keys(c) k where k not in ('action','id','requestId','expectedVersion','name','detail','creditor','icon','category','currency','amount','dueDate','mode','movementId','accountId','categoryId','occurredAt','note','paymentId')) then raise check_violation;end if;
 if op in ('create','pay') then
  if op='create' then select id,request_hash into target,hashed from finance.debts where user_id=owned and request_id=(c->>'requestId')::uuid;
  else select id,request_hash into target,hashed from finance.debt_payments where user_id=owned and request_id=(c->>'requestId')::uuid;end if;
  if found then if hashed<>sha256(convert_to(c::text,'UTF8')) then raise serialization_failure;end if;return jsonb_build_object('id',target);end if;
  hashed:=sha256(convert_to(c::text,'UTF8'));
 end if;
 if op<>'create' then select * into d from finance.debts where user_id=owned and id=(c->>'id')::uuid for update;if not found then raise no_data_found;end if;if d.deleted_at is not null then if op='delete' then return jsonb_build_object('id',d.id);end if;raise check_violation;end if;
 if op in ('update','delete') and d.version is distinct from (c->>'expectedVersion')::integer then raise serialization_failure;end if;end if;
 if op in ('create','update') then
  if c->>'amount' is null or c->>'amount' !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' or c->>'name' is null or c->>'detail' is null or c->>'creditor' is null or c->>'icon' is null then raise check_violation;end if;next_amount:=(c->>'amount')::numeric;
  if op='create' then
   if (select count(*) from finance.debts where user_id=owned)>=200 then raise program_limit_exceeded;end if;
   insert into finance.debts(user_id,request_id,request_hash,name,detail,creditor,icon,category,currency_code,amount,due_date) values(owned,(c->>'requestId')::uuid,hashed,btrim(c->>'name'),btrim(c->>'detail'),btrim(c->>'creditor'),c->>'icon',c->>'category',c->>'currency',next_amount,(c->>'dueDate')::date) returning id into target;
  else
   if c->>'currency' is distinct from d.currency_code then raise check_violation;end if;
   update finance.debts set name=btrim(c->>'name'),detail=btrim(c->>'detail'),creditor=btrim(c->>'creditor'),icon=c->>'icon',category=c->>'category',amount=next_amount,due_date=(c->>'dueDate')::date,version=version+1,updated_at=now() where user_id=owned and id=d.id;target:=d.id;
  end if;
 elsif op='delete' then update finance.debts set deleted_at=now(),version=version+1,updated_at=now() where user_id=owned and id=d.id;target:=d.id;
 elsif op='pay' then
  if (select count(*) from finance.debt_payments where user_id=owned)>=2000 then raise program_limit_exceeded;end if;
  if c->>'mode'='new' then
   if c->>'amount' is null or c->>'amount' !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' then raise check_violation;end if;
   select (api.post_movement((c->>'requestId')::uuid,'expense',(c->>'accountId')::uuid,(c->>'categoryId')::uuid,c->>'amount','Pago: '||d.name,coalesce(c->>'note',''),(c->>'occurredAt')::timestamptz)->>'id')::uuid into tx;
  elsif c->>'mode'='existing' then tx:=(c->>'movementId')::uuid;
  else raise check_violation;end if;
  perform 1 from finance.transactions where user_id=owned and id=tx and status='posted' and kind='expense' and currency_code=d.currency_code;if not found then raise check_violation;end if;
  if exists(select 1 from finance.transactions where user_id=owned and replaces_transaction_id=tx) then raise check_violation;end if;
  insert into finance.debt_payments(user_id,debt_id,origin_id,request_id,request_hash,created_expense,note) values(owned,d.id,tx,(c->>'requestId')::uuid,hashed,c->>'mode'='new',coalesce(c->>'note','')) returning id into target;
 elsif op in ('unlink','voidpay') then
  select * into p from finance.debt_payments where user_id=owned and debt_id=d.id and id=(c->>'paymentId')::uuid for update;if not found then raise no_data_found;end if;
  if op='unlink' then update finance.debt_payments set unlinked_at=coalesce(unlinked_at,now()) where user_id=owned and id=p.id;
  else if not p.created_expense then raise check_violation;end if;
   select effective_id into tx from finance.debt_payment_details where user_id=owned and id=p.id;
   perform api.void_movement(tx,(select version from finance.transactions where user_id=owned and id=tx),'Anulación de pago de deuda');
  end if;target:=p.id;
 end if;
 insert into finance.debt_events(user_id,debt_id,action) values(owned,case when op='create' then target else d.id end,op);
 return jsonb_build_object('id',target);
end $$;
grant create on schema api,finance to app_executor;
alter function api.read_debts() owner to app_executor;alter function api.debt_command(jsonb) owner to app_executor;alter function finance.check_debt_payments() owner to app_executor;
revoke create on schema api,finance from app_executor;
revoke all on function api.read_debts(),api.debt_command(jsonb),finance.check_debt_payments() from public,anon,authenticated;
grant execute on function api.read_debts(),api.debt_command(jsonb) to authenticated;
revoke app_executor from postgres;
