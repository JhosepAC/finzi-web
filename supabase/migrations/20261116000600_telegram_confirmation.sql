-- Phase 5: explicit delegated publication through the existing atomic ledger.
begin;
grant app_executor to postgres;
alter table telegram_private.links drop constraint links_scopes_check;
alter table telegram_private.links add constraint links_scopes_check check(cardinality(scopes)>0 and scopes <@ array['catalog:read','draft:write','movement:confirm']::text[] and array_position(scopes,null) is null);
alter table telegram_private.callbacks drop constraint callbacks_field_check;
alter table telegram_private.callbacks add constraint callbacks_field_check check(field in ('kind','currency','accountId','categoryId','cancel','edit','page','confirm'));
create table telegram_private.confirmations(
 user_id uuid not null,link_id uuid not null,draft_id uuid not null,callback_hash bytea not null check(octet_length(callback_hash)=32),result jsonb not null,
 created_at timestamptz not null default statement_timestamp(),primary key(user_id,draft_id),unique(link_id,callback_hash),
 foreign key(user_id,link_id) references telegram_private.links(user_id,id) on delete cascade,
 foreign key(user_id,draft_id) references telegram_private.drafts(user_id,id) on delete cascade
);
alter table telegram_private.confirmations enable row level security;
alter table telegram_private.confirmations force row level security;
revoke all on telegram_private.confirmations from public,anon,authenticated,finzi_telegram_gateway;
grant select,insert on telegram_private.confirmations to app_executor;
create policy own_rows on telegram_private.confirmations to app_executor using(user_id=(select finance.request_user_id())) with check(user_id=(select finance.request_user_id()));
create or replace function telegram_private.resolve_identity(c jsonb) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare owned uuid;
begin
 if session_user<>'finzi_telegram_gateway' or c is null or c->>'capability' is null or c->>'capability' !~ '^[a-f0-9]{64}$'
 or c->>'scope' is null or c->>'scope' not in ('catalog:read','draft:write','movement:confirm') then return null; end if;
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
 select jsonb_build_object('linkId',id,'generation',generation::text,'botId',bot_id,'telegramUserId',telegram_user_id,'chatId',chat_id,'capability',p_capability,'scope','catalog:read','canConfirm',case when 'movement:confirm'=any(scopes) then 'true' else 'false' end) into c
 from telegram_private.links where capability_hash=sha256(convert_to(p_capability,'UTF8')) and bot_id=p_bot and telegram_user_id=p_user and chat_id=p_chat;
 if telegram_private.resolve_identity(c) is null then return null; end if;
 -- Capability remains local to the caller, never echoed in results or logs.
 return c-'capability';
end $$;

create function api.telegram_set_movement_permission(p_id uuid,p_version integer,p_allow boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare owned uuid:=telegram_private.web_user(); l telegram_private.links%rowtype;
begin
 if owned is null or p_allow is null then raise insufficient_privilege;end if;
 perform 1 from finance.profiles where user_id=owned for update;
 select * into l from telegram_private.links where user_id=owned and id=p_id for update;
 if not found or l.revoked_at is not null or l.expires_at<=clock_timestamp() or telegram_private.web_user() is distinct from owned then raise insufficient_privilege;end if;
 if p_allow=('movement:confirm'=any(l.scopes)) then return true;end if;
 if p_version is null or l.version<>p_version then raise serialization_failure;end if;
 update telegram_private.links set scopes=case when p_allow then array_append(scopes,'movement:confirm') else array_remove(scopes,'movement:confirm') end,version=version+1 where user_id=owned and id=p_id;
 if not p_allow then delete from telegram_private.callbacks where user_id=owned and link_id=p_id and field='confirm';end if;
 return true;
end $$;
create or replace function api.telegram_link_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=telegram_private.web_user();
begin
 if owned is null then raise insufficient_privilege;end if;
 return jsonb_build_object('links',(select coalesce(jsonb_agg((to_jsonb(l)-'user_id'-'capability_hash'-'scopes')||jsonb_build_object('can_confirm','movement:confirm'=any(l.scopes))),'[]') from telegram_private.links l where user_id=owned),
 'attempts',(select coalesce(jsonb_agg(to_jsonb(a)-'user_id'-'challenge_hash'-'capability_hash'),'[]') from telegram_private.link_attempts a where user_id=owned and consumed_at is null and expires_at>clock_timestamp()));
end $$;
create or replace function telegram_private.snapshot_draft(owned uuid,target uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',d.id,'version',d.version,'state',d.state,'payload',d.payload,'awaiting',d.awaiting_field,'expiresAt',d.expires_at,'createdAt',d.created_at,'receipt',c.result)
 from telegram_private.drafts d left join telegram_private.confirmations c on c.user_id=d.user_id and c.draft_id=d.id where d.user_id=owned and d.id=target;
$$;
create or replace function telegram_private.draft_command(c jsonb,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; target uuid; d telegram_private.drafts%rowtype; cb telegram_private.callbacks%rowtype; prior telegram_private.conversation_actions%rowtype;
 op text:=command->>'action'; p jsonb; first_missing text; hashed bytea; result jsonb; previous text:=current_setting('finzi.telegram.context',true);page integer:=0;
begin
 if c->>'scope' is distinct from 'draft:write' then raise insufficient_privilege;end if;
 owned:=telegram_private.resolve_identity(c);if owned is null then raise insufficient_privilege;end if;
 if command is null or jsonb_typeof(command)<>'object' or octet_length(command::text)>12000 then raise check_violation;end if;
 perform set_config('finzi.telegram.context',c::text,true);
 perform 1 from finance.profiles where user_id=owned for update;
 perform 1 from telegram_private.links where user_id=owned and id=(c->>'linkId')::uuid for update;
 if telegram_private.resolve_identity(c) is null then raise insufficient_privilege;end if;
 update telegram_private.drafts set state='expired',source_text=null,payload='{}',awaiting_field=null,terminal_at=clock_timestamp(),version=version+1 where user_id=owned and link_id=(c->>'linkId')::uuid and state in ('needs_input','pending') and expires_at<=clock_timestamp();
 if op='replay' then
  select draft_id into target from telegram_private.conversation_actions where user_id=owned and link_id=(c->>'linkId')::uuid and update_id=command->>'updateId';
 elsif op='read' then
  select id into target from telegram_private.drafts where user_id=owned and link_id=(c->>'linkId')::uuid and payload?'receivedAt' and state in ('needs_input','pending')
  and (command->>'id' is null or id=(command->>'id')::uuid) order by created_at desc,id desc limit 1;
 elsif op in ('start','amend','choice','cancel') then
  if command->>'updateId' is null or command->>'updateId' !~ '^[0-9]{1,20}$' then raise check_violation;end if;
  hashed:=sha256(convert_to(command::text,'UTF8'));
  select * into prior from telegram_private.conversation_actions where user_id=owned and link_id=(c->>'linkId')::uuid and update_id=command->>'updateId';
  if found then
   if prior.payload_hash<>hashed then raise serialization_failure;end if;
   result:=telegram_private.snapshot_draft(owned,prior.draft_id);perform set_config('finzi.telegram.context',coalesce(previous,''),true);return result;
  end if;
  if (select count(*) from telegram_private.conversation_actions where user_id=owned and created_at>clock_timestamp()-interval '1 minute')>=30 then raise program_limit_exceeded;end if;
  if op='start' then
   target:=(telegram_private.create_draft(c,command->>'updateId',command->>'text')->>'id')::uuid;
  elsif op='choice' then
   if command->>'tokenHash' is null or command->>'tokenHash' !~ '^[a-f0-9]{64}$' then raise insufficient_privilege;end if;
   select * into cb from telegram_private.callbacks where user_id=owned and link_id=(c->>'linkId')::uuid and token_hash=decode(command->>'tokenHash','hex');
   if not found then raise no_data_found;end if;
   if cb.field='confirm' then raise insufficient_privilege;end if;target:=cb.draft_id;
  else target:=(command->>'id')::uuid;end if;
  select * into d from telegram_private.drafts where user_id=owned and link_id=(c->>'linkId')::uuid and id=target for update;
  if not found then raise no_data_found;end if;
  if d.state not in ('needs_input','pending') or d.expires_at<=clock_timestamp() then raise check_violation;end if;
  if op<>'start' and d.version is distinct from (case when op='choice' then cb.version else (command->>'version')::integer end) then raise serialization_failure;end if;
  if op='start' then
   p:=command->'payload';
   if (p->>'receivedAt')::timestamptz<clock_timestamp()-interval '15 minutes' then raise datetime_field_overflow;end if;
  else
   p:=d.payload;
   if op='amend' then
    if command->'payload'->>'receivedAt' is distinct from p->>'receivedAt' then raise check_violation;end if;
    p:=command->'payload';
   elsif op='choice' then
    if cb.field='cancel' then op:='cancel';
    elsif cb.field='edit' then
     if cb.value not in ('kind','amount','currency','accountId','categoryId','description','occurredAt') then raise check_violation;end if;
     update telegram_private.drafts set awaiting_field=cb.value,state='needs_input',version=version+1 where id=target;op:='edit';
    elsif cb.field='page' then page:=cb.value::integer;if page not between 0 and 20 then raise check_violation;end if;op:='page';
    else
     p:=jsonb_set(p,array[cb.field],to_jsonb(cb.value));
     if cb.field='accountId' and (p->>'occurredAt')::timestamptz<(select opening_at from finance.accounts where user_id=owned and id=cb.value::uuid) then p:=jsonb_set(p,'{occurredAt}','null');end if;
     if cb.field='kind' then p:=jsonb_set(p,'{categoryId}','null');end if;
     if cb.field='currency' then p:=jsonb_set(p,'{accountId}','null');end if;
    end if;
   end if;
  end if;
  if op='cancel' then
   update telegram_private.drafts set state='cancelled',payload='{}',source_text=null,awaiting_field=null,version=version+1,terminal_at=clock_timestamp() where id=target;
  elsif op not in ('page','edit') then
   first_missing:=telegram_private.validate_payload(p,owned);
   update telegram_private.drafts set payload=p,awaiting_field=first_missing,state=case when first_missing is null then 'pending' else 'needs_input' end,version=version+1 where id=target;
  end if;
  if op<>'page' then delete from telegram_private.callbacks where user_id=owned and draft_id=target;end if;
  insert into telegram_private.conversation_actions(user_id,link_id,update_id,payload_hash,draft_id) values(owned,d.link_id,command->>'updateId',hashed,target);
 else raise check_violation;end if;
 result:=telegram_private.snapshot_draft(owned,target);
 if op='page' then result:=result||jsonb_build_object('page',page);end if;
 perform set_config('finzi.telegram.context',coalesce(previous,''),true);return result;
end $$;
create or replace function telegram_private.register_callbacks(c jsonb,p_id uuid,p_version integer,choices jsonb) returns void language plpgsql security definer set search_path='' as $$
declare owned uuid; d telegram_private.drafts%rowtype; choice jsonb; previous text:=current_setting('finzi.telegram.context',true);
begin
 if c->>'scope' is distinct from 'draft:write' then raise insufficient_privilege;end if;
 owned:=telegram_private.resolve_identity(c);if owned is null then raise insufficient_privilege;end if;
 if jsonb_typeof(choices) is distinct from 'array' or jsonb_array_length(choices)>25 then raise check_violation;end if;
 perform set_config('finzi.telegram.context',c::text,true);
 perform 1 from finance.profiles where user_id=owned for update;
 perform 1 from telegram_private.links where user_id=owned and id=(c->>'linkId')::uuid for update;
 if telegram_private.resolve_identity(c) is null then raise insufficient_privilege;end if;
 select * into d from telegram_private.drafts where user_id=owned and link_id=(c->>'linkId')::uuid and id=p_id for update;
 if not found or d.version is distinct from p_version or d.state not in ('needs_input','pending') or d.expires_at<=clock_timestamp() then raise serialization_failure;end if;
 delete from telegram_private.callbacks where user_id=owned and draft_id=p_id;
 for choice in select value from jsonb_array_elements(choices) loop
  if choice->>'hash' is null or choice->>'hash' !~ '^[a-f0-9]{64}$' then raise check_violation;end if;
  if choice->>'field'='confirm' then
   if choice->>'value' is distinct from 'confirm' or d.state<>'pending' or d.awaiting_field is not null or telegram_private.resolve_identity(c||jsonb_build_object('scope','movement:confirm')) is distinct from owned then raise insufficient_privilege;end if;
   if telegram_private.validate_payload(d.payload,owned) is not null then raise check_violation;end if;
  end if;
  insert into telegram_private.callbacks(token_hash,user_id,link_id,draft_id,version,field,value) values(decode(choice->>'hash','hex'),owned,d.link_id,d.id,d.version,choice->>'field',choice->>'value');
 end loop;
 perform set_config('finzi.telegram.context',coalesce(previous,''),true);
end $$;

create or replace function api.export_personal_data(p_proof text,p_format text,p_currency text default 'PEN',p_kind text default null,p_account_id uuid default null,p_category_id uuid default null,p_from date default null,p_to date default null,p_query text default '',p_status text default 'all') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; owned uuid:=finance.request_user_id();
begin
 result:=finance.export_before_telegram(p_proof,p_format,p_currency,p_kind,p_account_id,p_category_id,p_from,p_to,p_query,p_status);
 if p_format='json' then
 result:=result||jsonb_build_object('telegram',jsonb_build_object(
 'confirmations',(select coalesce(jsonb_agg(jsonb_build_object('draft_id',cf.draft_id,'result',cf.result,'created_at',cf.created_at)),'[]') from telegram_private.confirmations cf where cf.user_id=owned),
 'links',(select coalesce(jsonb_agg(to_jsonb(l)-'user_id'-'capability_hash'),'[]') from telegram_private.links l where user_id=owned),
 'drafts',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'link_id',d.link_id,'state',case when state in ('needs_input','pending') and expires_at<=clock_timestamp() then 'expired' else state end,'source_text',case when expires_at>clock_timestamp() and state in ('needs_input','pending') then source_text end,'payload',case when expires_at>clock_timestamp() and state in ('needs_input','pending') then payload else '{}'::jsonb end,'created_at',created_at,'expires_at',expires_at,'movement_id',movement_id)),'[]') from telegram_private.drafts d where user_id=owned)));
 end if;
 return result;
end $$;
-- Lock order matches web publication, revocation, cancellation and personal deletion.
-- Publication, receipt, terminal transition and update deduplication commit together.
create function telegram_private.confirm_draft(c jsonb,p_token_hash text,p_update_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; basic jsonb:=c||jsonb_build_object('scope','draft:write'); previous text:=current_setting('finzi.telegram.context',true);
 cb telegram_private.callbacks%rowtype; d telegram_private.drafts%rowtype; prior telegram_private.conversation_actions%rowtype;
 target uuid; hashed bytea; published jsonb; receipt jsonb; p jsonb; result jsonb;
begin
 if c->>'scope' is distinct from 'movement:confirm' then raise insufficient_privilege;end if;
 owned:=telegram_private.resolve_identity(basic);if owned is null then raise insufficient_privilege;end if;
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_update_id is null or p_update_id !~ '^[0-9]{1,20}$' then raise check_violation;end if;
 perform set_config('finzi.telegram.context',basic::text,true);
 perform 1 from finance.profiles where user_id=owned for update;
 perform 1 from telegram_private.links where user_id=owned and id=(c->>'linkId')::uuid for update;
 if telegram_private.resolve_identity(basic) is distinct from owned then raise insufficient_privilege;end if;
 hashed:=sha256(convert_to(jsonb_build_array('confirm',p_token_hash)::text,'UTF8'));
 select * into prior from telegram_private.conversation_actions where user_id=owned and link_id=(c->>'linkId')::uuid and update_id=p_update_id;
 if found then
  if prior.payload_hash<>hashed then raise serialization_failure;end if;
  target:=prior.draft_id;
 else
  select draft_id into target from telegram_private.confirmations where user_id=owned and link_id=(c->>'linkId')::uuid and callback_hash=decode(p_token_hash,'hex');
  if target is null then
   if telegram_private.resolve_identity(c) is distinct from owned then raise insufficient_privilege;end if;
   perform set_config('finzi.telegram.context',c::text,true);
   select * into cb from telegram_private.callbacks where user_id=owned and link_id=(c->>'linkId')::uuid and token_hash=decode(p_token_hash,'hex') and field='confirm' and value='confirm';
   if not found then raise no_data_found;end if;
   select * into d from telegram_private.drafts where user_id=owned and link_id=(c->>'linkId')::uuid and id=cb.draft_id for update;
   if not found or d.state<>'pending' or d.awaiting_field is not null or d.version<>cb.version or d.generation<>(c->>'generation')::integer or d.expires_at<=clock_timestamp() then raise serialization_failure;end if;
   if telegram_private.resolve_identity(c) is distinct from owned then raise insufficient_privilege;end if;
   p:=d.payload;
   if telegram_private.validate_payload(p,owned) is not null then raise check_violation;end if;
   published:=api.post_movement(d.request_id,p->>'kind',(p->>'accountId')::uuid,(p->>'categoryId')::uuid,p->>'amount',p->>'description',p->>'note',(p->>'occurredAt')::timestamptz);
   -- Flush deferred ledger checks while delegated identity is still installed.
   set constraints finance.transaction_complete,finance.entries_complete,finance.debt_ledger_valid,finance.fixed_ledger_valid immediate;
   set constraints finance.transaction_complete,finance.entries_complete,finance.debt_ledger_valid,finance.fixed_ledger_valid deferred;
   if published->>'status' is distinct from 'posted' then raise serialization_failure;end if;
   receipt:=jsonb_build_object('movementId',published->>'id','kind',p->>'kind','amountMinor',((p->>'amount')::numeric*100)::numeric(20,0)::text,'currency',p->>'currency','description',btrim(p->>'description'),
    'accountName',(select name from finance.accounts where user_id=owned and id=(p->>'accountId')::uuid),
    'categoryName',(select name from finance.categories where user_id=owned and id=(p->>'categoryId')::uuid),
    'occurredAt',p->>'occurredAt','timezone',p->>'timezone','confirmedAt',clock_timestamp());
   insert into telegram_private.confirmations(user_id,link_id,draft_id,callback_hash,result) values(owned,d.link_id,d.id,decode(p_token_hash,'hex'),receipt);
   update telegram_private.drafts set state='confirmed',movement_id=(published->>'id')::uuid,payload='{}',source_text=null,awaiting_field=null,terminal_at=clock_timestamp(),version=version+1 where user_id=owned and id=d.id;
   delete from telegram_private.callbacks where user_id=owned and draft_id=d.id;
   target:=d.id;
  end if;
  insert into telegram_private.conversation_actions(user_id,link_id,update_id,payload_hash,draft_id) values(owned,(c->>'linkId')::uuid,p_update_id,hashed,target);
 end if;
 result:=telegram_private.snapshot_draft(owned,target);
 perform set_config('finzi.telegram.context',coalesce(previous,''),true);return result;
end $$;
grant create on schema api,telegram_private to app_executor;
alter function api.telegram_set_movement_permission(uuid,integer,boolean) owner to app_executor;
alter function telegram_private.confirm_draft(jsonb,text,text) owner to app_executor;
revoke create on schema api,telegram_private from app_executor;
revoke app_executor from postgres;
revoke all on function api.telegram_set_movement_permission(uuid,integer,boolean),telegram_private.confirm_draft(jsonb,text,text) from public,anon,authenticated,finzi_telegram_gateway;
grant execute on function api.telegram_set_movement_permission(uuid,integer,boolean) to authenticated;
grant execute on function telegram_private.confirm_draft(jsonb,text,text) to finzi_telegram_gateway;
commit;
