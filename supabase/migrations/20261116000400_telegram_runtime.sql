begin;
-- Recover a successful claim after a lost reply, only for exactly the same identity/capability.
create or replace function telegram_private.claim_link(p_challenge text,p_bot text,p_user text,p_chat text,p_capability_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare a telegram_private.link_attempts%rowtype;
begin
 if session_user<>'finzi_telegram_gateway' then raise insufficient_privilege; end if;
 if p_challenge is null or p_challenge !~ '^[a-f0-9]{64}$' or p_capability_hash is null or p_capability_hash !~ '^[a-f0-9]{64}$'
 or p_bot is null or p_bot !~ '^[1-9][0-9]{0,18}$' or p_user is null or p_user !~ '^[1-9][0-9]{0,18}$' or p_chat is distinct from p_user then raise check_violation; end if;
 select * into a from telegram_private.link_attempts where challenge_hash=sha256(convert_to(p_challenge,'UTF8')) for update;
 if not found or a.expires_at<=clock_timestamp() then raise insufficient_privilege; end if;
 if a.claimed_at is not null then
  if a.bot_id=p_bot and a.telegram_user_id=p_user and a.chat_id=p_chat and a.capability_hash=decode(p_capability_hash,'hex') then return a.id; end if;
  raise insufficient_privilege;
 end if;
 if a.consumed_at is not null then raise insufficient_privilege; end if;
 update telegram_private.link_attempts set claimed_at=clock_timestamp(),bot_id=p_bot,telegram_user_id=p_user,chat_id=p_chat,capability_hash=decode(p_capability_hash,'hex') where id=a.id;
 return a.id;
end $$;
-- Return no data until the web owner has activated this exact capability.
create function telegram_private.link_context(p_capability text,p_bot text,p_user text,p_chat text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;
begin
 if session_user<>'finzi_telegram_gateway' or p_capability is null or p_capability !~ '^[a-f0-9]{64}$' then raise insufficient_privilege; end if;
 select jsonb_build_object('linkId',id,'generation',generation::text,'botId',bot_id,'telegramUserId',telegram_user_id,'chatId',chat_id,'capability',p_capability,'scope','catalog:read') into c
 from telegram_private.links where capability_hash=sha256(convert_to(p_capability,'UTF8')) and bot_id=p_bot and telegram_user_id=p_user and chat_id=p_chat;
 if telegram_private.resolve_identity(c) is null then return null; end if;
 -- Capability remains local to the caller, never echoed in results or logs.
 return c-'capability';
end $$;
alter function telegram_private.link_context(text,text,text,text) owner to postgres;
revoke all on function telegram_private.link_context(text,text,text,text) from public,anon,authenticated,app_executor;
grant execute on function telegram_private.link_context(text,text,text,text) to finzi_telegram_gateway;
-- Expose stable expected-version guards to web mutations (retry after lost response remains safe).
create function api.telegram_revoke_link_versioned(p_id uuid,p_version integer) returns boolean language plpgsql security definer set search_path='' as $$
declare owned uuid:=telegram_private.web_user(); l telegram_private.links%rowtype;
begin
 if owned is null then raise insufficient_privilege; end if;
 perform 1 from finance.profiles where user_id=owned for update;
 select * into l from telegram_private.links where user_id=owned and id=p_id for update;
 if not found then raise no_data_found; end if;
 if l.revoked_at is not null then return true; end if;
 if p_version is null or l.version<>p_version then raise serialization_failure; end if;
 return api.telegram_revoke_link(p_id);
end $$;
grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.telegram_revoke_link_versioned(uuid,integer) owner to app_executor;
revoke create on schema api from app_executor;
revoke app_executor from postgres;
revoke all on function api.telegram_revoke_link_versioned(uuid,integer) from public,anon,authenticated,finzi_telegram_gateway;
grant execute on function api.telegram_revoke_link_versioned(uuid,integer) to authenticated;
commit;
