-- Phase 2 only: private persistence and delegated catalog/draft access.
-- No bot token, runtime password, polling, parser or financial publication entrypoint.
begin;
do $role$ begin
 if not exists(select 1 from pg_roles where rolname='finzi_telegram_gateway') then
  create role finzi_telegram_gateway login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
 elsif exists(select 1 from pg_roles where rolname='finzi_telegram_gateway' and (rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication or rolinherit))
 or exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='finzi_telegram_gateway') then
  raise exception 'Unsafe existing Telegram gateway role';
 end if;
end $role$;
create schema telegram_private;
revoke all on schema telegram_private from public,anon,authenticated;
grant usage on schema telegram_private to app_executor,finzi_telegram_gateway;

create table telegram_private.links (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references finance.profiles(user_id) on delete cascade,
 bot_id text not null check(bot_id ~ '^[1-9][0-9]{0,18}$'), telegram_user_id text not null check(telegram_user_id ~ '^[1-9][0-9]{0,18}$'),
 chat_id text not null check(chat_id=telegram_user_id), capability_hash bytea not null unique check(octet_length(capability_hash)=32),
 generation integer not null default 1 check(generation>0), scopes text[] not null default array['catalog:read','draft:write']::text[]
 check(cardinality(scopes)>0 and scopes <@ array['catalog:read','draft:write']::text[] and array_position(scopes,null) is null),
 created_at timestamptz not null default statement_timestamp(), expires_at timestamptz not null default (statement_timestamp()+interval '30 days'),
 revoked_at timestamptz, version integer not null default 1 check(version>0), unique(user_id,id),
 check(expires_at>created_at and expires_at<=created_at+interval '30 days')
);
create unique index telegram_owner_active on telegram_private.links(user_id) where revoked_at is null;
create unique index telegram_identity_active on telegram_private.links(bot_id,telegram_user_id) where revoked_at is null;
create table telegram_private.link_attempts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references finance.profiles(user_id) on delete cascade,
 challenge_hash bytea not null unique check(octet_length(challenge_hash)=32), created_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null default (statement_timestamp()+interval '5 minutes'),
 claimed_at timestamptz, consumed_at timestamptz, bot_id text, telegram_user_id text, chat_id text, capability_hash bytea,
 check(expires_at>created_at and expires_at<=created_at+interval '5 minutes'),
 check((claimed_at is null and bot_id is null and telegram_user_id is null and chat_id is null and capability_hash is null)
 or (num_nonnulls(claimed_at,bot_id,telegram_user_id,chat_id,capability_hash)=5 and bot_id ~ '^[1-9][0-9]{0,18}$' and telegram_user_id ~ '^[1-9][0-9]{0,18}$' and chat_id=telegram_user_id and octet_length(capability_hash)=32))
);
create table telegram_private.drafts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, link_id uuid not null, generation integer not null check(generation>0),
 source_update_id text not null check(source_update_id ~ '^[0-9]{1,20}$'), source_text text check(length(source_text)<=2000),
 version integer not null default 1 check(version>0), state text not null default 'needs_input' check(state in ('needs_input','pending','confirmed','cancelled','expired')),
 payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=8192),
 request_id uuid not null default gen_random_uuid(), movement_id uuid,
 created_at timestamptz not null default statement_timestamp(), expires_at timestamptz not null default (statement_timestamp()+interval '15 minutes'), terminal_at timestamptz,
 unique(user_id,id), unique(user_id,request_id), unique(link_id,source_update_id),
 foreign key(user_id,link_id) references telegram_private.links(user_id,id) on delete cascade,
 foreign key(user_id,movement_id) references finance.transactions(user_id,id) on delete cascade,
 check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
 check((state in ('needs_input','pending') and terminal_at is null and movement_id is null)
 or (state in ('cancelled','expired') and terminal_at is not null and movement_id is null and source_text is null)
 or (state='confirmed' and terminal_at is not null and movement_id is not null and source_text is null))
);
create table telegram_private.receipts (
 user_id uuid not null, link_id uuid not null, update_id text not null check(update_id ~ '^[0-9]{1,20}$'),
 operation text not null check(operation='draft:create'), payload_hash bytea not null check(octet_length(payload_hash)=32),
 draft_id uuid not null, created_at timestamptz not null default statement_timestamp(), primary key(link_id,update_id,operation),
 foreign key(user_id,link_id) references telegram_private.links(user_id,id) on delete cascade,
 foreign key(user_id,draft_id) references telegram_private.drafts(user_id,id) on delete cascade
);
-- Bootstrap lookup is narrowly confined to link metadata; financial tables keep their existing policies.
do $block$ declare t text; begin
 foreach t in array array['links','link_attempts','drafts','receipts'] loop
 execute format('alter table telegram_private.%I enable row level security',t);
 execute format('alter table telegram_private.%I force row level security',t);
 execute format('revoke all on telegram_private.%I from public,anon,authenticated,finzi_telegram_gateway',t);
 execute format('grant select,insert,update,delete on telegram_private.%I to app_executor',t);
 execute format('create policy own_rows on telegram_private.%I to app_executor using(user_id=(select finance.request_user_id())) with check(user_id=(select finance.request_user_id()))',t);
 end loop;
end $block$;
grant select on telegram_private.links to postgres;
grant select,update on telegram_private.link_attempts to postgres;
create policy bootstrap_link_lookup on telegram_private.links for select to postgres using(true);
create policy bootstrap_attempt_lookup on telegram_private.link_attempts to postgres using(true) with check(true);

-- Only the existing trusted helper / private entrypoints may invoke this verifier.
create function telegram_private.resolve_identity(c jsonb) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare owned uuid;
begin
 if session_user<>'finzi_telegram_gateway' or c is null or c->>'capability' is null or c->>'capability' !~ '^[a-f0-9]{64}$'
 or c->>'scope' is null or c->>'scope' not in ('catalog:read','draft:write') then return null; end if;
 select l.user_id into owned from telegram_private.links l join finance.profiles p on p.user_id=l.user_id
 join auth.users a on a.id=l.user_id
 where l.id::text=c->>'linkId' and l.bot_id=c->>'botId' and l.telegram_user_id=c->>'telegramUserId' and l.chat_id=c->>'chatId'
 and l.generation::text=c->>'generation' and l.capability_hash=sha256(convert_to(c->>'capability','UTF8'))
 and c->>'scope'=any(l.scopes) and l.revoked_at is null and l.expires_at>clock_timestamp()
 and p.onboarding_completed_at is not null and a.email_confirmed_at is not null
 and not exists(select 1 from ops.deletion_blocks b where b.user_id=l.user_id);
 return owned;
end $$;
alter function telegram_private.resolve_identity(jsonb) owner to postgres;
revoke all on function telegram_private.resolve_identity(jsonb) from public,anon,authenticated,finzi_telegram_gateway;
grant execute on function telegram_private.resolve_identity(jsonb) to app_executor;
create or replace function finance.request_user_id() returns uuid language plpgsql volatile security definer set search_path='' as $$
begin
 if session_user='finzi_telegram_gateway' then
  begin return telegram_private.resolve_identity(nullif(current_setting('finzi.telegram.context',true),'')::jsonb);
  exception when invalid_text_representation then return null; end;
 end if;
 return case when exists(select 1 from ops.deletion_blocks where user_id=auth.uid()) then null else auth.uid() end;
end $$;

-- Public web RPCs remain cookie/JWT-scoped. No Telegram HTTP routes are enabled yet.
create function api.telegram_issue_link(p_challenge_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id(); result jsonb;
begin
 if owned is null or session_user='finzi_telegram_gateway' then raise insufficient_privilege; end if;
 perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
 if not found then raise insufficient_privilege; end if;
 if p_challenge_hash is null or p_challenge_hash !~ '^[a-f0-9]{64}$' then raise check_violation; end if;
 if (select count(*) from telegram_private.link_attempts where user_id=owned and created_at>clock_timestamp()-interval '15 minutes')>=5 then raise program_limit_exceeded; end if;
 update telegram_private.link_attempts set consumed_at=clock_timestamp() where user_id=owned and consumed_at is null;
 insert into telegram_private.link_attempts(user_id,challenge_hash) values(owned,decode(p_challenge_hash,'hex')) returning jsonb_build_object('id',id,'expires_at',expires_at) into result;
 return result;
end $$;
-- A claim cannot activate a link. It only binds the one-use challenge to a private chat.
create function telegram_private.claim_link(p_challenge text,p_bot text,p_user text,p_chat text,p_capability_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if session_user<>'finzi_telegram_gateway' then raise insufficient_privilege; end if;
 if p_challenge is null or p_challenge !~ '^[a-f0-9]{64}$' or p_capability_hash is null or p_capability_hash !~ '^[a-f0-9]{64}$'
 or p_bot is null or p_bot !~ '^[1-9][0-9]{0,18}$' or p_user is null or p_user !~ '^[1-9][0-9]{0,18}$' or p_chat is distinct from p_user then raise check_violation; end if;
 update telegram_private.link_attempts set claimed_at=clock_timestamp(),bot_id=p_bot,telegram_user_id=p_user,chat_id=p_chat,capability_hash=decode(p_capability_hash,'hex')
 where challenge_hash=sha256(convert_to(p_challenge,'UTF8')) and consumed_at is null and claimed_at is null and expires_at>clock_timestamp()
 returning id into target;
 if target is null then raise insufficient_privilege; end if;
 return target;
end $$;
create function api.telegram_activate_link(p_attempt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id(); a telegram_private.link_attempts%rowtype; result jsonb;
begin
 if owned is null or session_user='finzi_telegram_gateway' then raise insufficient_privilege; end if;
 perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
 if not found then raise insufficient_privilege; end if;
 select * into a from telegram_private.link_attempts where user_id=owned and id=p_attempt for update;
 if not found or a.claimed_at is null or a.consumed_at is not null or a.expires_at<=clock_timestamp() then raise insufficient_privilege; end if;
 -- The web user must review this exact attempt's claimed identity before calling this RPC.
 insert into telegram_private.links(user_id,bot_id,telegram_user_id,chat_id,capability_hash) values(owned,a.bot_id,a.telegram_user_id,a.chat_id,a.capability_hash)
 returning jsonb_build_object('id',id,'generation',generation,'expires_at',expires_at) into result;
 update telegram_private.link_attempts set consumed_at=clock_timestamp() where id=a.id;
 return result;
end $$;
create function api.telegram_revoke_link(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id();
begin
 if owned is null or session_user='finzi_telegram_gateway' then raise insufficient_privilege; end if;
 perform 1 from finance.profiles where user_id=owned for update;
 perform 1 from telegram_private.links where user_id=owned and id=p_id for update;
 if not found then raise no_data_found; end if;
 update telegram_private.links set revoked_at=clock_timestamp(),version=version+1 where id=p_id and revoked_at is null;
 update telegram_private.drafts set state='cancelled',source_text=null,payload='{}',terminal_at=clock_timestamp(),version=version+1 where user_id=owned and link_id=p_id and state in ('needs_input','pending');
 return true;
end $$;
create function api.telegram_link_status() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if finance.request_user_id() is null or session_user='finzi_telegram_gateway' then raise insufficient_privilege; end if;
 return jsonb_build_object('links',(select coalesce(jsonb_agg(to_jsonb(l)-'user_id'-'capability_hash'-'scopes'),'[]') from telegram_private.links l where user_id=finance.request_user_id()),
 'attempts',(select coalesce(jsonb_agg(to_jsonb(a)-'user_id'-'challenge_hash'-'capability_hash'),'[]') from telegram_private.link_attempts a where user_id=finance.request_user_id() and consumed_at is null and expires_at>clock_timestamp()));
end $$;

-- Entry point is a probe of real financial RLS, not a general RPC proxy.
create function telegram_private.read_catalog(c jsonb,p_catalog text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; result jsonb; previous text:=current_setting('finzi.telegram.context',true);
begin
 if c->>'scope' is distinct from 'catalog:read' then raise insufficient_privilege; end if;
 owned:=telegram_private.resolve_identity(c); if owned is null then raise insufficient_privilege; end if;
 perform set_config('finzi.telegram.context',c::text,true);
 perform 1 from finance.profiles where user_id=owned for update;
 perform 1 from telegram_private.links where user_id=owned and id=(c->>'linkId')::uuid for update;
 if telegram_private.resolve_identity(c) is null then raise insufficient_privilege; end if;
 if p_catalog='accounts' then result:=api.read_accounts();
 elsif p_catalog='categories' then result:=api.read_categories();
 else raise check_violation; end if;
 perform set_config('finzi.telegram.context',coalesce(previous,''),true);
 return result;
end $$;
create function telegram_private.create_draft(c jsonb,p_update text,p_text text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; prior telegram_private.receipts%rowtype; target telegram_private.drafts%rowtype; hashed bytea; previous text:=current_setting('finzi.telegram.context',true);
begin
 if c->>'scope' is distinct from 'draft:write' then raise insufficient_privilege; end if;
 owned:=telegram_private.resolve_identity(c); if owned is null then raise insufficient_privilege; end if;
 if p_update is null or p_update !~ '^[0-9]{1,20}$' or p_text is null or length(btrim(p_text)) not between 1 and 2000 then raise check_violation; end if;
 perform set_config('finzi.telegram.context',c::text,true);
 perform 1 from finance.profiles where user_id=owned for update;
 perform 1 from telegram_private.links where user_id=owned and id=(c->>'linkId')::uuid for update;
 if telegram_private.resolve_identity(c) is null then raise insufficient_privilege; end if;
 hashed:=sha256(convert_to(p_text,'UTF8'));
 select * into prior from telegram_private.receipts where user_id=owned and link_id=(c->>'linkId')::uuid and update_id=p_update and operation='draft:create';
 if found then
  if prior.payload_hash<>hashed then raise serialization_failure; end if;
  select * into target from telegram_private.drafts where user_id=owned and id=prior.draft_id;
 else
  update telegram_private.drafts set state='expired',source_text=null,payload='{}',terminal_at=clock_timestamp(),version=version+1 where user_id=owned and state in ('needs_input','pending') and expires_at<=clock_timestamp();
  if (select count(*) from telegram_private.drafts where user_id=owned and state in ('needs_input','pending'))>=10 then raise program_limit_exceeded; end if;
  if (select count(*) from telegram_private.receipts where user_id=owned and created_at>clock_timestamp()-interval '1 minute')>=30 then raise program_limit_exceeded; end if;
  insert into telegram_private.drafts(user_id,link_id,generation,source_update_id,source_text) values(owned,(c->>'linkId')::uuid,(c->>'generation')::integer,p_update,p_text) returning * into target;
  insert into telegram_private.receipts(user_id,link_id,update_id,operation,payload_hash,draft_id) values(owned,target.link_id,p_update,'draft:create',hashed,target.id);
 end if;
 perform set_config('finzi.telegram.context',coalesce(previous,''),true);
 return jsonb_build_object('id',target.id,'version',target.version,'state',case when target.state in ('needs_input','pending') and target.expires_at<=clock_timestamp() then 'expired' else target.state end,'expires_at',target.expires_at);
end $$;

alter function telegram_private.claim_link(text,text,text,text,text) owner to postgres;

-- Own only the entrypoints, never the tables. Bootstrap claim/verifier stay narrowly owned by postgres.
grant app_executor to postgres;
grant create on schema api,telegram_private to app_executor;
alter function api.telegram_issue_link(text) owner to app_executor;
alter function api.telegram_activate_link(uuid) owner to app_executor;
alter function api.telegram_revoke_link(uuid) owner to app_executor;
alter function api.telegram_link_status() owner to app_executor;
alter function telegram_private.read_catalog(jsonb,text) owner to app_executor;
alter function telegram_private.create_draft(jsonb,text,text) owner to app_executor;
revoke create on schema api,telegram_private from app_executor;
revoke app_executor from postgres;
revoke all on function api.telegram_issue_link(text),api.telegram_activate_link(uuid),api.telegram_revoke_link(uuid),api.telegram_link_status() from public,anon,authenticated,finzi_telegram_gateway;
grant execute on function api.telegram_issue_link(text),api.telegram_activate_link(uuid),api.telegram_revoke_link(uuid),api.telegram_link_status() to authenticated;
revoke all on function telegram_private.claim_link(text,text,text,text,text),telegram_private.read_catalog(jsonb,text),telegram_private.create_draft(jsonb,text,text) from public,anon,authenticated;
grant execute on function telegram_private.claim_link(text,text,text,text,text),telegram_private.read_catalog(jsonb,text),telegram_private.create_draft(jsonb,text,text) to finzi_telegram_gateway;
commit;
