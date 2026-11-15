-- Recurring commitments are projections, never automatic ledger postings.
grant app_executor,finzi_deletion_worker to postgres;
create table finance.fixed_expenses (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references finance.profiles(user_id) on delete cascade,
 request_id uuid not null, request_hash bytea not null, name text not null check(length(btrim(name)) between 1 and 100),
 note text not null check(length(note)<=2000), category_id uuid not null, currency_code text not null check(currency_code in ('PEN','USD')),
 amount numeric(20,4) not null check(amount>0 and amount<=9999999999999999.99 and amount=trunc(amount,2) and amount not in ('NaN'::numeric,'Infinity'::numeric)),
 anchor date not null check(anchor between date '2000-01-01' and date '2100-12-31'),
 frequency text not null check(frequency in ('weekly','fortnightly','monthly','quarterly','yearly')),
 version integer not null default 1 check(version>0), deleted_at timestamptz, created_at timestamptz not null default now(),
 unique(user_id,id), unique(user_id,request_id), foreign key(user_id,category_id) references finance.categories(user_id,id)
);
create table finance.fixed_expense_payments (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references finance.profiles(user_id) on delete cascade,
 expense_id uuid not null, ordinal integer not null check(ordinal between 0 and 5300), origin_id uuid not null,
 amount numeric(20,4) not null, request_id uuid not null, request_hash bytea not null, recorded_at timestamptz not null default now(),
 foreign key(user_id,expense_id) references finance.fixed_expenses(user_id,id),
 foreign key(user_id,origin_id) references finance.transactions(user_id,id), unique(user_id,request_id)
);
do $$ declare t text; begin
 foreach t in array array['fixed_expenses','fixed_expense_payments'] loop
 execute format('alter table finance.%I enable row level security',t);
 execute format('alter table finance.%I force row level security',t);
 execute format('revoke all on finance.%I from public,anon,authenticated',t);
 execute format('grant select,insert on finance.%I to app_executor',t);
 execute format('create policy owned_read on finance.%I for select to app_executor using(user_id=(select finance.request_user_id()))',t);
 execute format('create policy owned_insert on finance.%I for insert to app_executor with check(user_id=(select finance.request_user_id()))',t);
 execute format('grant select,delete on finance.%I to finzi_deletion_worker',t);
 execute format('create policy cleanup_read on finance.%I for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=%I.user_id))',t,t);
 execute format('create policy cleanup_delete on finance.%I for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=%I.user_id))',t,t);
 end loop;
end $$;
grant update on finance.fixed_expenses to app_executor;
create policy owned_update on finance.fixed_expenses for update to app_executor using(user_id=finance.request_user_id()) with check(user_id=finance.request_user_id());

create function finance.fixed_due(p_anchor date,p_frequency text,p_ordinal integer) returns date
language sql immutable strict set search_path='' as $$
 select case when due between date '2000-01-01' and date '2100-12-31' then due end from (
 select case p_frequency when 'weekly' then p_anchor+p_ordinal*7 when 'fortnightly' then p_anchor+p_ordinal*15
 else (p_anchor+make_interval(months=>p_ordinal*case p_frequency when 'monthly' then 1 when 'quarterly' then 3 when 'yearly' then 12 end))::date end as due) dates
$$;
revoke all on function finance.fixed_due(date,text,integer) from public,anon,authenticated;
grant execute on function finance.fixed_due(date,text,integer) to app_executor;
create view finance.fixed_payment_details with(security_invoker=true) as
with recursive chain as (
 select p.id as payment_id,p.user_id,t.id,t.kind,t.currency_code,t.amount,t.status,t.occurred_at from finance.fixed_expense_payments p join finance.transactions t on t.user_id=p.user_id and t.id=p.origin_id
 union all select c.payment_id,c.user_id,t.id,t.kind,t.currency_code,t.amount,t.status,t.occurred_at from chain c join finance.transactions t on t.user_id=c.user_id and t.replaces_transaction_id=c.id
)
select p.*,c.id as effective_id,c.kind,c.currency_code,c.amount as effective_amount,c.status,c.occurred_at
from finance.fixed_expense_payments p join chain c on c.payment_id=p.id and c.user_id=p.user_id
where not exists(select 1 from finance.transactions n where n.user_id=c.user_id and n.replaces_transaction_id=c.id);
grant select on finance.fixed_payment_details to app_executor;
create function finance.check_fixed_payments() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from finance.fixed_payment_details p join finance.fixed_expenses e on e.user_id=p.user_id and e.id=p.expense_id where p.user_id=new.user_id and (p.kind<>'expense' or p.currency_code<>e.currency_code or p.effective_amount<>p.amount))
 or exists(select 1 from finance.fixed_payment_details where user_id=new.user_id and status='posted' group by expense_id,ordinal having count(*)>1)
 or exists(select 1 from finance.fixed_payment_details where user_id=new.user_id group by effective_id having count(*)>1)
 or exists(select 1 from finance.fixed_payment_details f join finance.debt_payment_details d on d.user_id=f.user_id and d.effective_id=f.effective_id and d.unlinked_at is null where f.user_id=new.user_id)
 then raise check_violation; end if;
 return null;
end $$;
create constraint trigger fixed_payment_valid after insert on finance.fixed_expense_payments deferrable initially deferred for each row execute function finance.check_fixed_payments();
create constraint trigger fixed_ledger_valid after insert or update on finance.transactions deferrable initially deferred for each row execute function finance.check_fixed_payments();
create constraint trigger fixed_debt_valid after insert or update on finance.debt_payments deferrable initially deferred for each row execute function finance.check_fixed_payments();

create function api.fixed_expense_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb:=p_command; owned uuid:=finance.request_user_id(); op text:=c->>'action'; e finance.fixed_expenses%rowtype;
 target uuid; tx uuid; old_hash bytea; hashed bytea:=sha256(convert_to(c::text,'UTF8')); n integer; due date;
begin
 perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
 if not found then raise insufficient_privilege; end if;
 if op is null or op not in ('create','update','delete','pay') or jsonb_typeof(c)<>'object'
 or exists(select 1 from jsonb_object_keys(c) k where k not in ('action','id','expectedVersion','requestId','name','note','categoryId','currency','amount','dueDate','frequency','ordinal','mode','accountId','movementId','occurredAt')) then raise check_violation; end if;
 if op in ('create','pay') then
 if op='create' then select id,request_hash into target,old_hash from finance.fixed_expenses where user_id=owned and request_id=(c->>'requestId')::uuid;
 else select id,request_hash into target,old_hash from finance.fixed_expense_payments where user_id=owned and request_id=(c->>'requestId')::uuid; end if;
 if found then if old_hash<>hashed then raise serialization_failure; end if; return jsonb_build_object('id',target); end if;
 end if;
 if op<>'create' then
 select * into e from finance.fixed_expenses where user_id=owned and id=(c->>'id')::uuid for update;
 if not found then raise no_data_found; end if;
 if e.deleted_at is not null then if op='delete' then return jsonb_build_object('id',e.id); end if; raise check_violation; end if;
 if e.version is distinct from (c->>'expectedVersion')::integer then raise serialization_failure; end if;
 end if;
 if op in ('create','update') then
 if c->>'amount' is null or c->>'amount' !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' or c->>'name' is null or c->>'note' is null then raise check_violation; end if;
 perform 1 from finance.categories cat left join finance.categories parent on parent.user_id=cat.user_id and parent.id=cat.parent_id
 where cat.user_id=owned and cat.id=(c->>'categoryId')::uuid and cat.kind='expense' and cat.status='active' and cat.deleted_at is null and coalesce(parent.status,'active')='active';
 if not found then raise check_violation; end if;
 if op='create' then
 if (select count(*) from finance.fixed_expenses where user_id=owned)>=200 then raise program_limit_exceeded; end if;
 insert into finance.fixed_expenses(user_id,request_id,request_hash,name,note,category_id,currency_code,amount,anchor,frequency)
 values(owned,(c->>'requestId')::uuid,hashed,btrim(c->>'name'),btrim(c->>'note'),(c->>'categoryId')::uuid,c->>'currency',(c->>'amount')::numeric,(c->>'dueDate')::date,c->>'frequency') returning id into target;
 else
 -- The calendar/currency are immutable; paid occurrences retain their amount snapshot.
 if c->>'currency' is distinct from e.currency_code or (c->>'dueDate')::date is distinct from e.anchor or c->>'frequency' is distinct from e.frequency then raise check_violation; end if;
 update finance.fixed_expenses set name=btrim(c->>'name'),note=btrim(c->>'note'),category_id=(c->>'categoryId')::uuid,amount=(c->>'amount')::numeric,version=version+1 where user_id=owned and id=e.id;
 target:=e.id;
 end if;
 elsif op='delete' then
 update finance.fixed_expenses set deleted_at=clock_timestamp(),version=version+1 where user_id=owned and id=e.id; target:=e.id;
 elsif op='pay' then
 n:=(c->>'ordinal')::integer; due:=finance.fixed_due(e.anchor,e.frequency,n);
 if n is null or n not between 0 and 5300 or due is null then raise check_violation; end if;
 if exists(select 1 from finance.fixed_payment_details where user_id=owned and expense_id=e.id and ordinal=n and status='posted') then raise serialization_failure; end if;
 if (select count(*) from finance.fixed_expense_payments where user_id=owned)>=2000 then raise program_limit_exceeded; end if;
 if c->>'mode'='new' then
 select (api.post_movement((c->>'requestId')::uuid,'expense',(c->>'accountId')::uuid,e.category_id,e.amount::numeric(18,2)::text,'Pago: '||e.name,e.note,(c->>'occurredAt')::timestamptz)->>'id')::uuid into tx;
 elsif c->>'mode'='existing' then tx:=(c->>'movementId')::uuid;
 else raise check_violation; end if;
 perform 1 from finance.transactions where user_id=owned and id=tx and kind='expense' and status='posted' and currency_code=e.currency_code and amount=e.amount;
 if not found or exists(select 1 from finance.transactions where user_id=owned and replaces_transaction_id=tx) then raise check_violation; end if;
 insert into finance.fixed_expense_payments(user_id,expense_id,ordinal,origin_id,amount,request_id,request_hash) values(owned,e.id,n,tx,e.amount,(c->>'requestId')::uuid,hashed) returning id into target;
 update finance.fixed_expenses set version=version+1 where user_id=owned and id=e.id;
 end if;
 return jsonb_build_object('id',target);
end $$;

create function api.read_fixed_expenses(p_month date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id(); today date; m date;
begin
 select (statement_timestamp() at time zone timezone)::date into today from finance.profiles where user_id=owned and onboarding_completed_at is not null;
 if not found then raise insufficient_privilege; end if;
 m:=date_trunc('month',coalesce(p_month,today))::date;
 if m not between date '2000-01-01' and date '2100-12-01' then raise check_violation; end if;
 return jsonb_build_object('today',today,'month',m,'expenses',(
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from (
 select e.id,e.name,e.note,e.category_id,c.name as category_name,e.currency_code,(e.amount*100)::numeric(20,0)::text as amount_minor,e.anchor,e.frequency,e.version,e.deleted_at,e.created_at,
 finance.fixed_due(e.anchor,e.frequency,(select min(n) from generate_series(0,5300) n where not exists(select 1 from finance.fixed_payment_details fp where fp.user_id=e.user_id and fp.expense_id=e.id and fp.ordinal=n and fp.status='posted'))) as next_due
 from finance.fixed_expenses e join finance.categories c on c.user_id=e.user_id and c.id=e.category_id where e.user_id=owned) x),
 'occurrences',(
 select coalesce(jsonb_agg(jsonb_build_object('expense_id',e.id,'ordinal',g.n,'due_date',d.due,'amount_minor',(coalesce(p.amount,e.amount)*100)::numeric(20,0)::text,'paid',p.id is not null,'movement_id',p.effective_id,'paid_at',p.occurred_at) order by d.due,e.id),'[]')
 from finance.fixed_expenses e cross join lateral generate_series(0,case e.frequency when 'weekly' then greatest(0,((m+interval '1 month')::date-e.anchor)/7) when 'fortnightly' then greatest(0,((m+interval '1 month')::date-e.anchor)/15) else greatest(0,((extract(year from m)::integer-extract(year from e.anchor)::integer)*12+extract(month from m)::integer-extract(month from e.anchor)::integer)/case e.frequency when 'monthly' then 1 when 'quarterly' then 3 else 12 end+1) end) g(n)
 cross join lateral (select finance.fixed_due(e.anchor,e.frequency,g.n) as due) d
 left join finance.fixed_payment_details p on p.user_id=e.user_id and p.expense_id=e.id and p.ordinal=g.n and p.status='posted'
 where e.user_id=owned and (e.deleted_at is null or p.id is not null) and d.due>=m and d.due<(m+interval '1 month')::date),
 'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'expense_id',p.expense_id,'ordinal',p.ordinal,'due_date',finance.fixed_due(e.anchor,e.frequency,p.ordinal),'amount_minor',(p.amount*100)::numeric(20,0)::text,'active',p.status='posted','movement_id',p.effective_id,'paid_at',p.occurred_at,'recorded_at',p.recorded_at) order by p.recorded_at desc),'[]') from finance.fixed_payment_details p join finance.fixed_expenses e on e.user_id=p.user_id and e.id=p.expense_id where p.user_id=owned),
 'accounts',api.read_accounts(),'categories',(api.read_categories())->'categories');
end $$;
grant create on schema finance,api to app_executor;
alter function finance.check_fixed_payments() owner to app_executor;
alter function api.fixed_expense_command(jsonb) owner to app_executor;
alter function api.read_fixed_expenses(date) owner to app_executor;
revoke create on schema finance,api from app_executor;
revoke all on function finance.check_fixed_payments(),api.fixed_expense_command(jsonb),api.read_fixed_expenses(date) from public,anon,authenticated;
grant execute on function api.fixed_expense_command(jsonb),api.read_fixed_expenses(date) to authenticated;

-- Preserve the existing proof/quota/export contract and append private commitments.
alter function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) rename to export_before_fixed_expenses;
alter function api.export_before_fixed_expenses(text,text,text,text,uuid,uuid,date,date,text,text) set schema finance;
revoke all on function finance.export_before_fixed_expenses(text,text,text,text,uuid,uuid,date,date,text,text) from public,anon,authenticated;
grant execute on function finance.export_before_fixed_expenses(text,text,text,text,uuid,uuid,date,date,text,text) to app_executor;
create function api.export_personal_data(p_proof text,p_format text,p_currency text default 'PEN',p_kind text default null,p_account_id uuid default null,p_category_id uuid default null,p_from date default null,p_to date default null,p_query text default '',p_status text default 'all') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; catalog jsonb;
begin
 result:=finance.export_before_fixed_expenses(p_proof,p_format,p_currency,p_kind,p_account_id,p_category_id,p_from,p_to,p_query,p_status);
 if p_format='json' then catalog:=api.read_fixed_expenses(); result:=result||jsonb_build_object('fixed_expenses',catalog->'expenses','fixed_expense_payments',catalog->'payments'); end if;
 return result;
end $$;
grant create on schema api to app_executor;
alter function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) from public,anon,authenticated;
grant execute on function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) to authenticated;
-- Clean new references before the established ledger/profile purge.
alter function ops.purge_profile(uuid,text) rename to purge_profile_before_fixed_expenses;
revoke all on function ops.purge_profile_before_fixed_expenses(uuid,text) from public,anon,authenticated;
create function ops.purge_profile(p_id uuid,p_lease text) returns void language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 select s.user_id into subject from ops.deletion_subjects s join ops.deletion_receipts r on r.id=s.receipt_id where r.id=p_id and r.lease_hash=sha256(convert_to(p_lease,'UTF8')) and r.lease_until>clock_timestamp() and r.manifest_digest is not null and r.stage<>'completed';
 if not found then raise insufficient_privilege; end if;
 delete from finance.fixed_expense_payments where user_id=subject;
 delete from finance.fixed_expenses where user_id=subject;
 perform ops.purge_profile_before_fixed_expenses(p_id,p_lease);
end $$;
alter function ops.purge_profile(uuid,text) owner to finzi_deletion_worker;
revoke all on function ops.purge_profile(uuid,text) from public,anon,authenticated;
grant execute on function ops.purge_profile(uuid,text) to finzi_deletion_worker,postgres;
revoke app_executor,finzi_deletion_worker from postgres;

-- A category referenced by an unpaid commitment also needs a historical identity.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('api.delete_category(uuid,integer)'::regprocedure);
 definition:=replace(definition,'if exists(select 1 from finance.transactions where user_id=owned and category_id=p_id)',
 'if exists(select 1 from finance.fixed_expenses where user_id=owned and category_id=p_id) or exists(select 1 from finance.transactions where user_id=owned and category_id=p_id)');
 execute definition;
end $$;
