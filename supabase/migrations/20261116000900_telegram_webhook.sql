-- Additive staging transport. Existing financial functions and identity verifier stay unchanged.
begin;
create role finzi_telegram_transport_executor nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
grant finzi_telegram_transport_executor,app_executor to postgres;
grant usage on schema telegram_private to finzi_telegram_transport_executor;

create table telegram_private.transport_bots (
 bot_id text primary key check(bot_id ~ '^[1-9][0-9]{0,15}$'),
 mode text not null check(mode='webhook'), enabled boolean not null default false
);
create table telegram_private.transport_events (
 id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity unique,
 bot_id text not null references telegram_private.transport_bots(bot_id),
 update_id bigint not null check(update_id between 0 and 9007199254740991),
 telegram_user_id text not null check(telegram_user_id ~ '^[1-9][0-9]{0,15}$'), chat_id text not null check(chat_id=telegram_user_id),
 event_type text not null check(event_type in ('message','callback_query')),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text check(length(payload_ciphertext) between 32 and 50000),
 result_ciphertext text check(length(result_ciphertext) between 32 and 180000),
 state text not null default 'pending' check(state in ('pending','processing','ready','delivering','done','dead')),
 received_at timestamptz not null default clock_timestamp(), processed_at timestamptz, delivered_at timestamptz,
 available_at timestamptz not null default clock_timestamp(), attempts integer not null default 0 check(attempts between 0 and 5),
 delivery_attempts integer not null default 0 check(delivery_attempts between 0 and 5),
 lease_hash bytea check(octet_length(lease_hash)=32), lease_until timestamptz,
 error_code text check(error_code in ('retry','timeout','delivery','invalid_cipher','unexpected')),
 unique(bot_id,update_id)
);
create index transport_event_pending on telegram_private.transport_events(bot_id,sequence) where state<>'done';
create table telegram_private.transport_credentials (
 bot_id text not null references telegram_private.transport_bots(bot_id), telegram_user_id text not null,
 challenge_hash text not null check(challenge_hash ~ '^[a-f0-9]{64}$'), ciphertext text not null check(length(ciphertext) between 32 and 4000),
 created_at timestamptz not null default clock_timestamp(), primary key(bot_id,telegram_user_id,challenge_hash)
);
do $$ declare t text; begin
 foreach t in array array['transport_bots','transport_events','transport_credentials'] loop
  execute format('alter table telegram_private.%I enable row level security',t);
  execute format('alter table telegram_private.%I force row level security',t);
  execute format('revoke all on telegram_private.%I from public,anon,authenticated,finzi_telegram_gateway',t);
  execute format('grant select,insert,update,delete on telegram_private.%I to finzi_telegram_transport_executor',t);
  execute format('create policy transport_executor on telegram_private.%I to finzi_telegram_transport_executor using(true) with check(true)',t);
  execute format('create policy transport_operator on telegram_private.%I to postgres using(true) with check(true)',t);
 end loop;
end $$;
grant usage,select on sequence telegram_private.transport_events_sequence_seq to finzi_telegram_transport_executor;

create function telegram_private.transport_guard(p_bot text) returns void language plpgsql security definer set search_path='' as $$
begin
 if session_user<>'finzi_telegram_gateway' then raise insufficient_privilege; end if;
 if not exists(select 1 from telegram_private.transport_bots where bot_id=p_bot and enabled and mode='webhook') then raise insufficient_privilege; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('finzi-telegram:'||p_bot,0)) then raise lock_not_available; end if;
end $$;
create function telegram_private.enqueue_update(p_bot text,p_update bigint,p_user text,p_chat text,p_type text,p_hash text,p_cipher text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; prior telegram_private.transport_events%rowtype;
begin
 perform telegram_private.transport_guard(p_bot);
 if p_user is distinct from p_chat or p_user is null or p_user !~ '^[1-9][0-9]{0,15}$' or p_type not in ('message','callback_query') then raise check_violation; end if;
 select * into prior from telegram_private.transport_events where bot_id=p_bot and update_id=p_update;
 if found then
  if prior.payload_hash is distinct from p_hash or prior.telegram_user_id is distinct from p_user or prior.chat_id is distinct from p_chat or prior.event_type is distinct from p_type then raise serialization_failure; end if;
  return prior.id;
 end if;
 if (select count(*) from telegram_private.transport_events where bot_id=p_bot and state<>'done')>=10000 then raise program_limit_exceeded; end if;
 insert into telegram_private.transport_events(bot_id,update_id,telegram_user_id,chat_id,event_type,payload_hash,payload_ciphertext)
 values(p_bot,p_update,p_user,p_chat,p_type,p_hash,p_cipher) returning id into result;
 return result;
end $$;
create function telegram_private.claim_update(p_bot text,p_lease text,p_stage text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e telegram_private.transport_events%rowtype;
begin
 perform telegram_private.transport_guard(p_bot);
 update telegram_private.transport_events set state='dead',lease_hash=null,lease_until=null,error_code='timeout' where bot_id=p_bot and lease_until<=clock_timestamp() and ((state='processing' and attempts>=5) or (state='delivering' and delivery_attempts>=5));
 if p_lease is null or p_lease !~ '^[a-f0-9]{64}$' or p_stage not in ('process','deliver') then raise check_violation; end if;
 select * into e from telegram_private.transport_events t where t.bot_id=p_bot and t.available_at<=clock_timestamp()
 and case when p_stage='process' then t.attempts<5 and (t.state='pending' or (t.state='processing' and t.lease_until<=clock_timestamp()))
 else t.delivery_attempts<5 and (t.state='ready' or (t.state='delivering' and t.lease_until<=clock_timestamp())) end
 and not exists(select 1 from telegram_private.transport_events older where older.bot_id=t.bot_id and older.telegram_user_id=t.telegram_user_id and older.sequence<t.sequence and older.state<>'done')
 order by t.sequence for update skip locked limit 1;
 if not found then return null; end if;
 update telegram_private.transport_events set state=case when p_stage='process' then 'processing' else 'delivering' end,
 lease_hash=decode(p_lease,'hex'),lease_until=clock_timestamp()+interval '45 seconds',
 attempts=attempts+case when p_stage='process' then 1 else 0 end,
 delivery_attempts=delivery_attempts+case when p_stage='deliver' then 1 else 0 end where id=e.id returning * into e;
 return to_jsonb(e)-'lease_hash';
end $$;
create function telegram_private.leased_update(p_bot text,p_id uuid,p_lease text) returns telegram_private.transport_events
language plpgsql security definer set search_path='' as $$
declare e telegram_private.transport_events%rowtype;
begin
 perform telegram_private.transport_guard(p_bot);
 select * into e from telegram_private.transport_events where id=p_id and bot_id=p_bot and state in ('processing','delivering')
 and lease_hash=decode(p_lease,'hex') and lease_until>clock_timestamp() for update;
 if not found then raise insufficient_privilege; end if;
 update telegram_private.transport_events set lease_until=clock_timestamp()+interval '45 seconds' where id=e.id;
 return e;
end $$;
create function telegram_private.update_credentials(p_bot text,p_id uuid,p_lease text,p_challenge text default null,p_cipher text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e telegram_private.transport_events%rowtype;
begin
 e:=telegram_private.leased_update(p_bot,p_id,p_lease);
 if e.state<>'processing' then raise insufficient_privilege; end if;
 if p_challenge is not null then
  if p_challenge !~ '^[a-f0-9]{64}$' or p_cipher is null then raise check_violation; end if;
  if not exists(select 1 from telegram_private.transport_credentials where bot_id=p_bot and telegram_user_id=e.telegram_user_id and challenge_hash=p_challenge) then
   if (select count(*) from telegram_private.transport_credentials where bot_id=p_bot and telegram_user_id=e.telegram_user_id and created_at>clock_timestamp()-interval '15 minutes')>=5 then raise program_limit_exceeded; end if;
   if (select count(*) from telegram_private.transport_credentials where bot_id=p_bot)>=1000 then raise program_limit_exceeded; end if;
   insert into telegram_private.transport_credentials(bot_id,telegram_user_id,challenge_hash,ciphertext) values(p_bot,e.telegram_user_id,p_challenge,p_cipher);
  end if;
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('challengeHash',challenge_hash,'ciphertext',ciphertext) order by created_at),'[]') from telegram_private.transport_credentials where bot_id=p_bot and telegram_user_id=e.telegram_user_id);
end $$;
create function telegram_private.dispatch_update(p_bot text,p_id uuid,p_lease text,p_operation text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e telegram_private.transport_events%rowtype; c jsonb; op jsonb; result jsonb;
begin
 e:=telegram_private.leased_update(p_bot,p_id,p_lease);
 if e.state<>'processing' and p_operation<>'context' then raise insufficient_privilege; end if;
 c:=p_args->'context';
 if p_operation='claim' then
  perform telegram_private.claim_link(p_args->>'challenge',p_bot,e.telegram_user_id,e.chat_id,p_args->>'hash');return 'null'::jsonb;
 elsif p_operation='context' then
  return telegram_private.link_context(p_args->>'capability',p_bot,e.telegram_user_id,e.chat_id);
 end if;
 if c->>'botId' is distinct from p_bot or c->>'telegramUserId' is distinct from e.telegram_user_id or c->>'chatId' is distinct from e.chat_id then raise insufficient_privilege; end if;
 case p_operation
 when 'catalog' then return telegram_private.conversation_catalog(c||jsonb_build_object('scope','catalog:read'));
 when 'command' then
  op:=p_args->'command';
  if op ? 'updateId' and op->>'updateId' is distinct from e.update_id::text then raise insufficient_privilege; end if;
  return telegram_private.draft_command(c||jsonb_build_object('scope','draft:write'),op);
 when 'callbacks' then
  perform telegram_private.register_callbacks(c||jsonb_build_object('scope','draft:write'),(p_args->>'id')::uuid,(p_args->>'version')::integer,p_args->'choices');return 'null'::jsonb;
 when 'confirm' then
  if e.event_type<>'callback_query' then raise insufficient_privilege; end if;
  return telegram_private.confirm_draft(c||jsonb_build_object('scope','movement:confirm'),p_args->>'tokenHash',e.update_id::text);
 when 'query' then
  op:=p_args->'operation';
  if op ? 'updateId' and op->>'updateId' is distinct from e.update_id::text then raise insufficient_privilege; end if;
  c:=c||jsonb_build_object('scope','report:read');perform telegram_private.lock_query(c);
  return telegram_private.read_query(c,op);
 else raise insufficient_privilege;
 end case;
end $$;
create function telegram_private.finish_update(p_bot text,p_id uuid,p_lease text,p_cipher text default null) returns void
language plpgsql security definer set search_path='' as $$
declare e telegram_private.transport_events%rowtype;
begin
 e:=telegram_private.leased_update(p_bot,p_id,p_lease);
 if e.state='processing' and p_cipher is null then raise check_violation; end if;
 update telegram_private.transport_events set
 state=case when e.state='processing' then 'ready' else 'done' end,
 result_ciphertext=case when e.state='processing' then p_cipher else null end,
 payload_ciphertext=null,
 processed_at=case when e.state='processing' then clock_timestamp() else processed_at end,
 delivered_at=case when e.state='delivering' then clock_timestamp() else null end,
 lease_hash=null,lease_until=null,error_code=null where id=e.id;
end $$;
create function telegram_private.retry_update(p_bot text,p_id uuid,p_lease text,p_error text,p_retryable boolean) returns void
language plpgsql security definer set search_path='' as $$
declare e telegram_private.transport_events%rowtype;
begin
 e:=telegram_private.leased_update(p_bot,p_id,p_lease);
 if p_error is null or p_error not in ('retry','timeout','delivery','invalid_cipher','unexpected') then raise check_violation; end if;
 update telegram_private.transport_events set
 state=case when not p_retryable or (case when e.state='processing' then attempts else delivery_attempts end)>=5 then 'dead' when e.state='processing' then 'pending' else 'ready' end,
 available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,case when e.state='processing' then e.attempts else e.delivery_attempts end)::integer)),
 lease_hash=null,lease_until=null,error_code=p_error where id=e.id;
end $$;

-- Only the bounded dispatcher can invoke the legacy protocol on this staging gateway.
revoke execute on all functions in schema telegram_private from finzi_telegram_gateway;
grant execute on function telegram_private.claim_link(text,text,text,text,text),telegram_private.link_context(text,text,text,text),telegram_private.conversation_catalog(jsonb),telegram_private.draft_command(jsonb,jsonb),telegram_private.register_callbacks(jsonb,uuid,integer,jsonb),telegram_private.confirm_draft(jsonb,text,text),telegram_private.lock_query(jsonb),telegram_private.read_query(jsonb,jsonb) to finzi_telegram_transport_executor;
grant create on schema telegram_private to finzi_telegram_transport_executor;
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='telegram_private' and p.proname in ('transport_guard','enqueue_update','claim_update','leased_update','update_credentials','dispatch_update','finish_update','retry_update') loop
  execute format('alter function %s owner to finzi_telegram_transport_executor',f);
  execute format('revoke all on function %s from public,anon,authenticated,finzi_telegram_gateway',f);
 end loop;
end $$;
grant execute on function telegram_private.enqueue_update(text,bigint,text,text,text,text,text),telegram_private.claim_update(text,text,text),telegram_private.update_credentials(text,uuid,text,text,text),telegram_private.dispatch_update(text,uuid,text,text,jsonb),telegram_private.finish_update(text,uuid,text,text),telegram_private.retry_update(text,uuid,text,text,boolean) to finzi_telegram_gateway;
revoke create on schema telegram_private from finzi_telegram_transport_executor;
revoke finzi_telegram_transport_executor,app_executor from postgres;
commit;
