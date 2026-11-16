-- Phase 4: conversations and previews only. No financial publication permission.
begin;
alter table telegram_private.drafts add column awaiting_field text check(awaiting_field in ('kind','amount','currency','accountId','categoryId','description','occurredAt'));
create table telegram_private.callbacks(
 token_hash bytea primary key check(octet_length(token_hash)=32),user_id uuid not null,link_id uuid not null,draft_id uuid not null,
 version integer not null check(version>0),field text not null check(field in ('kind','currency','accountId','categoryId','cancel','edit','page')),value text not null check(length(value)<=100),
 foreign key(user_id,link_id) references telegram_private.links(user_id,id) on delete cascade,
 foreign key(user_id,draft_id) references telegram_private.drafts(user_id,id) on delete cascade
);
create table telegram_private.conversation_actions(
 user_id uuid not null,link_id uuid not null,update_id text not null check(update_id ~ '^[0-9]{1,20}$'),payload_hash bytea not null check(octet_length(payload_hash)=32),draft_id uuid not null,
 created_at timestamptz not null default statement_timestamp(),primary key(link_id,update_id),
 foreign key(user_id,link_id) references telegram_private.links(user_id,id) on delete cascade,
 foreign key(user_id,draft_id) references telegram_private.drafts(user_id,id) on delete cascade
);
do $block$ declare t text;begin
 foreach t in array array['callbacks','conversation_actions'] loop
 execute format('alter table telegram_private.%I enable row level security',t);
 execute format('alter table telegram_private.%I force row level security',t);
 execute format('revoke all on telegram_private.%I from public,anon,authenticated,finzi_telegram_gateway',t);
 execute format('grant select,insert,update,delete on telegram_private.%I to app_executor',t);
 execute format('create policy own_rows on telegram_private.%I to app_executor using(user_id=(select finance.request_user_id())) with check(user_id=(select finance.request_user_id()))',t);
 end loop;
end $block$;
create function telegram_private.conversation_catalog(c jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; result jsonb; previous text:=current_setting('finzi.telegram.context',true);
begin
 if c->>'scope' is distinct from 'catalog:read' then raise insufficient_privilege; end if;
 owned:=telegram_private.resolve_identity(c);if owned is null then raise insufficient_privilege;end if;
 perform set_config('finzi.telegram.context',c::text,true);
 result:=jsonb_build_object('timezone',(select timezone from finance.profiles where user_id=owned),'accounts',telegram_private.read_catalog(c,'accounts'),'categories',telegram_private.read_catalog(c,'categories')->'categories');
 perform set_config('finzi.telegram.context',coalesce(previous,''),true);return result;
end $$;
-- Returns the first missing field. Rejects forged references, money types, dates and profile drift.
create function telegram_private.validate_payload(p jsonb,owned uuid) returns text language plpgsql security definer set search_path='' as $$
declare field text; value text; first_missing text; a finance.accounts%rowtype; moment timestamptz; received timestamptz;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>8192
 or exists(select 1 from jsonb_object_keys(p) k where k not in ('kind','amount','currency','accountId','categoryId','description','occurredAt','receivedAt','timezone','note','warnings')) then raise check_violation;end if;
 if p->>'timezone' is distinct from (select timezone from finance.profiles where user_id=owned) then raise serialization_failure;end if;
 if p->>'receivedAt' is null or p->>'receivedAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then raise check_violation;end if;
 received:=(p->>'receivedAt')::timestamptz;
 if not isfinite(received) or received>clock_timestamp() then raise datetime_field_overflow;end if;
 if p->>'note' is null or length(p->>'note')>2000 or jsonb_typeof(p->'note')<>'string' then raise check_violation;end if;
 if jsonb_typeof(p->'warnings') is distinct from 'array' or jsonb_array_length(p->'warnings')>10 or exists(select 1 from jsonb_array_elements(p->'warnings') w where jsonb_typeof(w)<>'string' or length(w#>>'{}')>300) then raise check_violation;end if;
 foreach field in array array['kind','amount','currency','accountId','categoryId','description','occurredAt'] loop
 value:=p->>field;
 if value is null then if first_missing is null then first_missing:=field;end if;
 elsif jsonb_typeof(p->field)<>'string' then raise check_violation;end if;
 end loop;
 if p->>'kind' is not null and p->>'kind' not in ('income','expense') then raise check_violation;end if;
 if p->>'amount' is not null then
  if p->>'amount' !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' then raise check_violation;end if;
  if (p->>'amount')::numeric<=0 then raise check_violation;end if;
 end if;
 if p->>'currency' is not null and p->>'currency' not in ('PEN','USD') then raise check_violation;end if;
 if p->>'description' is not null and length(btrim(p->>'description')) not between 1 and 200 then raise check_violation;end if;
 if p->>'accountId' is not null then
  select * into a from finance.accounts where user_id=owned and id=(p->>'accountId')::uuid and status='active';
  if not found or (p->>'currency' is not null and a.currency_code<>p->>'currency') then raise check_violation;end if;
 end if;
 if p->>'categoryId' is not null then
  perform 1 from finance.categories c left join finance.categories parent on parent.user_id=c.user_id and parent.id=c.parent_id
  where c.user_id=owned and c.id=(p->>'categoryId')::uuid and c.status='active' and c.deleted_at is null and c.kind=p->>'kind'
  and coalesce(parent.status,'active')='active' and parent.deleted_at is null;
  if not found then raise check_violation;end if;
 end if;
 if p->>'occurredAt' is not null then
  if p->>'occurredAt' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then raise check_violation;end if;
  moment:=(p->>'occurredAt')::timestamptz;
  if not isfinite(moment) or moment>received or (a.id is not null and moment<a.opening_at) then raise datetime_field_overflow;end if;
 end if;
 return first_missing;
end $$;
create function telegram_private.snapshot_draft(owned uuid,target uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',id,'version',version,'state',state,'payload',payload,'awaiting',awaiting_field,'expiresAt',expires_at,'createdAt',created_at) from telegram_private.drafts where user_id=owned and id=target;
$$;
create function telegram_private.draft_command(c jsonb,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
   if not found then raise no_data_found;end if;target:=cb.draft_id;
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
create function telegram_private.register_callbacks(c jsonb,p_id uuid,p_version integer,choices jsonb) returns void language plpgsql security definer set search_path='' as $$
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
  insert into telegram_private.callbacks(token_hash,user_id,link_id,draft_id,version,field,value) values(decode(choice->>'hash','hex'),owned,d.link_id,d.id,d.version,choice->>'field',choice->>'value');
 end loop;
 perform set_config('finzi.telegram.context',coalesce(previous,''),true);
end $$;
grant app_executor to postgres;
grant create on schema telegram_private to app_executor;
alter function telegram_private.conversation_catalog(jsonb) owner to app_executor;
alter function telegram_private.validate_payload(jsonb,uuid) owner to app_executor;
alter function telegram_private.snapshot_draft(uuid,uuid) owner to app_executor;
alter function telegram_private.draft_command(jsonb,jsonb) owner to app_executor;
alter function telegram_private.register_callbacks(jsonb,uuid,integer,jsonb) owner to app_executor;
revoke create on schema telegram_private from app_executor;
revoke app_executor from postgres;
revoke all on function telegram_private.conversation_catalog(jsonb),telegram_private.validate_payload(jsonb,uuid),telegram_private.snapshot_draft(uuid,uuid),telegram_private.draft_command(jsonb,jsonb),telegram_private.register_callbacks(jsonb,uuid,integer,jsonb) from public,anon,authenticated,finzi_telegram_gateway;
grant execute on function telegram_private.conversation_catalog(jsonb),telegram_private.draft_command(jsonb,jsonb),telegram_private.register_callbacks(jsonb,uuid,integer,jsonb) to finzi_telegram_gateway;
commit;
