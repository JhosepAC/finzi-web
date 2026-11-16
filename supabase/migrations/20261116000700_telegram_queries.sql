-- Phase 6: explicitly authorized, bounded read-only financial queries.
begin;
grant app_executor to postgres;
alter table telegram_private.links drop constraint links_scopes_check;
alter table telegram_private.links add constraint links_scopes_check check(cardinality(scopes)>0 and scopes <@ array['catalog:read','draft:write','movement:confirm','report:read']::text[] and array_position(scopes,null) is null);
create or replace function telegram_private.resolve_identity(c jsonb) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare owned uuid;
begin
 if session_user<>'finzi_telegram_gateway' or c is null or c->>'capability' is null or c->>'capability' !~ '^[a-f0-9]{64}$'
 or c->>'scope' is null or c->>'scope' not in ('catalog:read','draft:write','movement:confirm','report:read') then return null; end if;
 select l.user_id into owned from telegram_private.links l join finance.profiles p on p.user_id=l.user_id
 join auth.users a on a.id=l.user_id
 where l.id::text=c->>'linkId' and l.bot_id=c->>'botId' and l.telegram_user_id=c->>'telegramUserId' and l.chat_id=c->>'chatId'
 and l.generation::text=c->>'generation' and l.capability_hash=sha256(convert_to(c->>'capability','UTF8'))
 and c->>'scope'=any(l.scopes) and l.revoked_at is null and l.expires_at>clock_timestamp()
 and p.onboarding_completed_at is not null and a.email_confirmed_at is not null
 and not exists(select 1 from ops.deletion_blocks b where b.user_id=l.user_id);
 return owned;
end $$;
create or replace function telegram_private.link_context(p_capability text,p_bot text,p_user text,p_chat text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;
begin
 if session_user<>'finzi_telegram_gateway' or p_capability is null or p_capability !~ '^[a-f0-9]{64}$' then raise insufficient_privilege; end if;
 select jsonb_build_object('linkId',id,'generation',generation::text,'botId',bot_id,'telegramUserId',telegram_user_id,'chatId',chat_id,'capability',p_capability,'scope','catalog:read','canReport',case when 'report:read'=any(scopes) then 'true' else 'false' end,'canConfirm',case when 'movement:confirm'=any(scopes) then 'true' else 'false' end) into c
 from telegram_private.links where capability_hash=sha256(convert_to(p_capability,'UTF8')) and bot_id=p_bot and telegram_user_id=p_user and chat_id=p_chat;
 if telegram_private.resolve_identity(c) is null then return null; end if;
 -- Capability remains local to the caller, never echoed in results or logs.
 return c-'capability';
end $$;
create or replace function api.telegram_link_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=telegram_private.web_user();
begin
 if owned is null then raise insufficient_privilege;end if;
 return jsonb_build_object('links',(select coalesce(jsonb_agg((to_jsonb(l)-'user_id'-'capability_hash'-'scopes')||jsonb_build_object('can_confirm','movement:confirm'=any(l.scopes),'can_report','report:read'=any(l.scopes))),'[]') from telegram_private.links l where user_id=owned),
 'attempts',(select coalesce(jsonb_agg(to_jsonb(a)-'user_id'-'challenge_hash'-'capability_hash'),'[]') from telegram_private.link_attempts a where user_id=owned and consumed_at is null and expires_at>clock_timestamp()));
end $$;
create function api.telegram_set_query_permission(p_id uuid,p_version integer,p_allow boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare owned uuid:=telegram_private.web_user(); l telegram_private.links%rowtype;
begin
 if owned is null or p_allow is null then raise insufficient_privilege;end if;
 perform 1 from finance.profiles where user_id=owned for update;
 select * into l from telegram_private.links where user_id=owned and id=p_id for update;
 if not found or l.revoked_at is not null or l.expires_at<=clock_timestamp() or telegram_private.web_user() is distinct from owned then raise insufficient_privilege;end if;
 if p_allow=('report:read'=any(l.scopes)) then return true;end if;
 if p_version is null or l.version<>p_version then raise serialization_failure;end if;
 update telegram_private.links set scopes=case when p_allow then array_append(scopes,'report:read') else array_remove(scopes,'report:read') end,version=version+1 where user_id=owned and id=p_id;
 if not p_allow then delete from telegram_private.query_sessions where user_id=owned and link_id=p_id;end if;
 return true;
end $$;

create table telegram_private.query_sessions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null,link_id uuid not null,update_id text not null check(update_id ~ '^[0-9]{1,20}$'),
 command text not null,currency text not null check(currency in ('PEN','USD')),data jsonb not null,
 created_at timestamptz not null default statement_timestamp(),expires_at timestamptz not null default statement_timestamp()+interval '15 minutes',
 unique(user_id,id),unique(link_id,update_id),foreign key(user_id,link_id) references telegram_private.links(user_id,id) on delete cascade
);
create table telegram_private.query_cursors(
 token_hash bytea primary key check(octet_length(token_hash)=32),user_id uuid not null,session_id uuid not null,page integer not null check(page>=0),
 foreign key(user_id,session_id) references telegram_private.query_sessions(user_id,id) on delete cascade
);
do $b$ declare t text;begin
 foreach t in array array['query_sessions','query_cursors'] loop
 execute format('alter table telegram_private.%I enable row level security',t);
 execute format('alter table telegram_private.%I force row level security',t);
 execute format('revoke all on telegram_private.%I from public,anon,authenticated,finzi_telegram_gateway',t);
 execute format('grant select,insert,delete on telegram_private.%I to app_executor',t);
 execute format('create policy own_rows on telegram_private.%I to app_executor using(user_id=(select finance.request_user_id())) with check(user_id=(select finance.request_user_id()))',t);
 end loop;
end $b$;
create function telegram_private.read_query(c jsonb,op jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; previous text:=current_setting('finzi.telegram.context',true); q telegram_private.query_sessions%rowtype;
 name text:=op->>'command'; currency text:=coalesce(op->>'currency','PEN'); zone text; today date; first_day date; captured timestamptz:=statement_timestamp();
 summary jsonb; items jsonb:='[]'; result jsonb; batch jsonb; choice jsonb; page integer:=0; total integer; accounts jsonb;
begin
 if c->>'scope' is distinct from 'report:read' then raise insufficient_privilege;end if;
 owned:=telegram_private.resolve_identity(c);if owned is null then raise insufficient_privilege;end if;
 if op is null or jsonb_typeof(op)<>'object' or octet_length(op::text)>8192 then raise check_violation;end if;
 perform set_config('finzi.telegram.context',c::text,true);
 perform 1 from finance.profiles where user_id=owned for update;
 perform 1 from telegram_private.links where user_id=owned and id=(c->>'linkId')::uuid for update;
 if telegram_private.resolve_identity(c) is distinct from owned then raise insufficient_privilege;end if;
 select timezone into zone from finance.profiles where user_id=owned;
 delete from telegram_private.query_sessions where user_id=owned and expires_at<=clock_timestamp();
 if op->>'action'='open' then
  if name is null or name not in ('hoy','semana','mes','saldo','gastos','ingresos','cuentas','categorias','pendientes') or currency not in ('PEN','USD') or op->>'updateId' is null or op->>'updateId' !~ '^[0-9]{1,20}$' then raise check_violation;end if;
  select * into q from telegram_private.query_sessions where user_id=owned and link_id=(c->>'linkId')::uuid and update_id=op->>'updateId';
  if found then
   if q.command<>name or q.currency<>currency then raise serialization_failure;end if;
  else
   if (select count(*) from telegram_private.query_sessions where user_id=owned and link_id=(c->>'linkId')::uuid)>=30 then raise program_limit_exceeded;end if;
   today:=(captured at time zone zone)::date;
   first_day:=case name when 'hoy' then today when 'semana' then today-6 else date_trunc('month',today::timestamp)::date end;
   accounts:=api.read_accounts();
   if name in ('hoy','semana','mes','gastos','ingresos') then
    summary:=api.read_overview(currency,'custom',null,first_day,today,null);
    if name='gastos' then
     select coalesce(jsonb_agg(x),'[]') into items from jsonb_array_elements(summary->'categories') x where x->>'kind'='expense';
    elsif name='ingresos' then
     -- Reuse the canonical history projection, not page totals or a second ledger.
     -- One bounded aggregate avoids repeating the core paginated totals for every page.
     select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'description',m.description,'amount_minor',m.amount_minor,'occurred_at',m.occurred_at,'account_name',m.account_name) order by m.occurred_at desc,m.id desc),'[]') into items
     from (select v.id,v.description,v.amount_minor,v.occurred_at,v.account_name from finance.movement_details v
      where v.user_id=owned and v.kind='income' and v.status='posted' and v.deleted_at is null and v.currency_code=currency
       and v.occurred_at>=(first_day::timestamp at time zone zone) and v.occurred_at<((today+1)::timestamp at time zone zone) and v.occurred_at<=captured
       and exists(select 1 from jsonb_array_elements(accounts) a where a->>'id'=v.account_id::text)
      order by v.occurred_at desc,v.id desc limit 10001) m;
     if jsonb_array_length(items)>10000 then raise program_limit_exceeded;end if;

    end if;
    result:=jsonb_build_object('income_minor',summary->>'income_minor','expense_minor',summary->>'expense_minor','from',first_day,'to',today);
   elsif name in ('cuentas','saldo') then
    select coalesce(jsonb_agg(jsonb_build_object('name',a->>'name','status',a->>'status','balance_minor',a->>'balance_minor')),'[]') into items from jsonb_array_elements(accounts) a where a->>'currency_code'=currency;
    result:=jsonb_build_object('balance_minor',(select coalesce(sum((a->>'balance_minor')::numeric),0)::numeric(30,0)::text from jsonb_array_elements(items) a));
   elsif name='categorias' then
    batch:=api.read_categories();
    select coalesce(jsonb_agg(jsonb_build_object('name',case when a->>'parent_id' is null then a->>'name' else coalesce((select p->>'name' from jsonb_array_elements(batch->'categories') p where p->>'id'=a->>'parent_id'),'Categoría')||' / '||(a->>'name') end,'kind',a->>'kind','archived',a->'effective_archived')),'[]') into items from jsonb_array_elements(batch->'categories') a;
    result:='{}';
   else
    select coalesce(jsonb_agg(jsonb_build_object('state',state,'awaiting',awaiting_field,'expires_at',expires_at) order by created_at,id),'[]') into items from telegram_private.drafts where user_id=owned and link_id=(c->>'linkId')::uuid and state in ('pending','needs_input') and expires_at>clock_timestamp();
    result:='{}';
   end if;
   result:=result||jsonb_build_object('command',name,'currency',currency,'timezone',zone,'as_of',captured,'items',items);
   insert into telegram_private.query_sessions(user_id,link_id,update_id,command,currency,data) values(owned,(c->>'linkId')::uuid,op->>'updateId',name,currency,result) returning * into q;
  end if;
 elsif op->>'action'='page' then
  if op->>'tokenHash' is null or op->>'tokenHash' !~ '^[a-f0-9]{64}$' then raise insufficient_privilege;end if;
  select s.*,x.page into q.id,q.user_id,q.link_id,q.update_id,q.command,q.currency,q.data,q.created_at,q.expires_at,page
  from telegram_private.query_cursors x join telegram_private.query_sessions s on s.user_id=x.user_id and s.id=x.session_id
  where x.user_id=owned and s.link_id=(c->>'linkId')::uuid and x.token_hash=decode(op->>'tokenHash','hex');
  if not found then raise no_data_found;end if;
 elsif op->>'action'='buttons' then
  select * into q from telegram_private.query_sessions where user_id=owned and link_id=(c->>'linkId')::uuid and id=(op->>'id')::uuid;
  if not found then raise no_data_found;end if;
  page:=(op->>'page')::integer;
 else raise check_violation;end if;
 if q.expires_at<=clock_timestamp() or q.data->>'timezone' is distinct from zone then raise serialization_failure;end if;
 total:=jsonb_array_length(q.data->'items');
 if page is null or page<0 or page>greatest(0,(total-1)/10) then raise check_violation;end if;
 if op->>'action'='buttons' then
  if jsonb_typeof(op->'choices') is distinct from 'array' or jsonb_array_length(op->'choices')>2 then raise check_violation;end if;
  for choice in select value from jsonb_array_elements(op->'choices') loop
   if choice->>'hash' is null or choice->>'hash' !~ '^[a-f0-9]{64}$' or (choice->>'page')::integer not in (page-1,page+1) or (choice->>'page')::integer<0 or (choice->>'page')::integer>greatest(0,(total-1)/10) then raise check_violation;end if;
   insert into telegram_private.query_cursors(token_hash,user_id,session_id,page) values(decode(choice->>'hash','hex'),owned,q.id,(choice->>'page')::integer) on conflict(token_hash) do nothing;
  end loop;
  result:=null;
 else
  result:=(q.data-'items')||jsonb_build_object('id',q.id,'page',page,'total',total,'items',(select coalesce(jsonb_agg(x.value order by x.ordinality),'[]') from jsonb_array_elements(q.data->'items') with ordinality x where x.ordinality>page*10 and x.ordinality<=page*10+10));
 end if;
 perform set_config('finzi.telegram.context',coalesce(previous,''),true);return result;
end $$;
grant create on schema api,telegram_private to app_executor;
alter function api.telegram_set_query_permission(uuid,integer,boolean) owner to app_executor;
alter function telegram_private.read_query(jsonb,jsonb) owner to app_executor;
revoke create on schema api,telegram_private from app_executor;
revoke app_executor from postgres;
revoke all on function api.telegram_set_query_permission(uuid,integer,boolean),telegram_private.read_query(jsonb,jsonb) from public,anon,authenticated,finzi_telegram_gateway;
grant execute on function api.telegram_set_query_permission(uuid,integer,boolean) to authenticated;
grant execute on function telegram_private.read_query(jsonb,jsonb) to finzi_telegram_gateway;

-- Expired projections are caches, not another financial history.
create function telegram_private.cleanup_queries(p_limit integer default 500) returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if p_limit is null or p_limit not between 1 and 500 then raise check_violation;end if;
 with stale as(select id from telegram_private.query_sessions where expires_at<=clock_timestamp() order by expires_at limit p_limit for update skip locked)
 delete from telegram_private.query_sessions q using stale where q.id=stale.id;
 get diagnostics affected=row_count;return affected;
end $$;
alter function telegram_private.cleanup_queries(integer) owner to postgres;
grant select,delete on telegram_private.query_sessions,telegram_private.query_cursors to postgres;
revoke all on function telegram_private.cleanup_queries(integer) from public,anon,authenticated,app_executor,finzi_telegram_gateway;
grant execute on function telegram_private.cleanup_queries(integer) to finzi_telegram_gateway;

-- Acquire the owner's mutex before the report statement establishes its cutoff/snapshot.
create function telegram_private.lock_query(c jsonb) returns void language plpgsql security definer set search_path='' as $$
declare owned uuid; previous text:=current_setting('finzi.telegram.context',true);
begin
 if c->>'scope' is distinct from 'report:read' then raise insufficient_privilege;end if;
 owned:=telegram_private.resolve_identity(c);if owned is null then raise insufficient_privilege;end if;
 perform set_config('finzi.telegram.context',c::text,true);
 perform 1 from finance.profiles where user_id=owned for update;
 perform 1 from telegram_private.links where user_id=owned and id=(c->>'linkId')::uuid for update;
 if telegram_private.resolve_identity(c) is distinct from owned then raise insufficient_privilege;end if;
 perform set_config('finzi.telegram.context',coalesce(previous,''),true);
end $$;
grant app_executor to postgres;
grant create on schema telegram_private to app_executor;
alter function telegram_private.lock_query(jsonb) owner to app_executor;
revoke create on schema telegram_private from app_executor;
revoke app_executor from postgres;
revoke all on function telegram_private.lock_query(jsonb) from public,anon,authenticated,finzi_telegram_gateway;
grant execute on function telegram_private.lock_query(jsonb) to finzi_telegram_gateway;
commit;
