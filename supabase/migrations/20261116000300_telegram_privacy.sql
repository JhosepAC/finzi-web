-- Privacy/retention and verified web identity for phase 2. No transport or financial writes.
begin;
create function telegram_private.web_user() returns uuid language sql stable security definer set search_path='' as $$
 select a.id from auth.users a join finance.profiles p on p.user_id=a.id
 where session_user<>'finzi_telegram_gateway' and a.id=finance.request_user_id() and a.email_confirmed_at is not null and p.onboarding_completed_at is not null;
$$;
alter function telegram_private.web_user() owner to postgres;
revoke all on function telegram_private.web_user() from public,anon,authenticated,finzi_telegram_gateway;
grant execute on function telegram_private.web_user() to app_executor;
do $block$ declare signature text; definition text; begin
 foreach signature in array array['api.telegram_issue_link(text)','api.telegram_activate_link(uuid)','api.telegram_revoke_link(uuid)','api.telegram_link_status()'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 definition:=replace(definition,'finance.request_user_id()','telegram_private.web_user()');
 execute definition;
 end loop;
end $block$;

-- Existing proof, quota, CSV and financial snapshot semantics stay in the established export.
alter function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) rename to export_before_telegram;
alter function api.export_before_telegram(text,text,text,text,uuid,uuid,date,date,text,text) set schema finance;
revoke all on function finance.export_before_telegram(text,text,text,text,uuid,uuid,date,date,text,text) from public,anon,authenticated;
grant execute on function finance.export_before_telegram(text,text,text,text,uuid,uuid,date,date,text,text) to app_executor;
create function api.export_personal_data(p_proof text,p_format text,p_currency text default 'PEN',p_kind text default null,p_account_id uuid default null,p_category_id uuid default null,p_from date default null,p_to date default null,p_query text default '',p_status text default 'all') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; owned uuid:=finance.request_user_id();
begin
 result:=finance.export_before_telegram(p_proof,p_format,p_currency,p_kind,p_account_id,p_category_id,p_from,p_to,p_query,p_status);
 if p_format='json' then
 result:=result||jsonb_build_object('telegram',jsonb_build_object(
 'links',(select coalesce(jsonb_agg(to_jsonb(l)-'user_id'-'capability_hash'),'[]') from telegram_private.links l where user_id=owned),
 'drafts',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'link_id',d.link_id,'state',case when state in ('needs_input','pending') and expires_at<=clock_timestamp() then 'expired' else state end,'source_text',case when expires_at>clock_timestamp() and state in ('needs_input','pending') then source_text end,'payload',case when expires_at>clock_timestamp() and state in ('needs_input','pending') then payload else '{}'::jsonb end,'created_at',created_at,'expires_at',expires_at,'movement_id',movement_id)),'[]') from telegram_private.drafts d where user_id=owned)));
 end if;
 return result;
end $$;
grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) owner to app_executor;
revoke create on schema api from app_executor;
revoke app_executor from postgres;
revoke all on function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) from public,anon,authenticated;
grant execute on function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) to authenticated;

-- Profile FK cascades purge metadata with the existing personal deletion workflow.
-- This bounded maintenance function never reads/writes financial tables and cannot publish.
create function telegram_private.cleanup(p_limit integer default 500) returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if p_limit is null or p_limit not between 1 and 500 then raise check_violation; end if;
 with stale as (select id from telegram_private.drafts where state in ('needs_input','pending') and expires_at<=clock_timestamp() order by expires_at limit p_limit for update skip locked)
 update telegram_private.drafts d set state='expired',source_text=null,payload='{}',terminal_at=clock_timestamp(),version=version+1 from stale where d.id=stale.id;
 get diagnostics affected=row_count;
 with stale as (select id from telegram_private.drafts where terminal_at<clock_timestamp()-interval '24 hours' and (source_text is not null or payload<>'{}'::jsonb) order by terminal_at limit p_limit for update skip locked)
 update telegram_private.drafts d set source_text=null,payload='{}' from stale where d.id=stale.id;
 -- Retain dedup tombstones throughout link validity, then at least 30 days after inactivity.
 with stale as (select id from telegram_private.links where coalesce(revoked_at,expires_at)<clock_timestamp()-interval '30 days' order by expires_at limit p_limit for update skip locked)
 delete from telegram_private.links l using stale where l.id=stale.id;
 with stale as (select id from telegram_private.link_attempts where expires_at<clock_timestamp()-interval '24 hours' order by expires_at limit p_limit for update skip locked)
 delete from telegram_private.link_attempts a using stale where a.id=stale.id;
 return affected;
end $$;
alter function telegram_private.cleanup(integer) owner to postgres;
grant all on telegram_private.links,telegram_private.link_attempts,telegram_private.drafts,telegram_private.receipts to postgres;
revoke all on function telegram_private.cleanup(integer) from public,anon,authenticated,finzi_telegram_gateway,app_executor;
grant execute on function telegram_private.cleanup(integer) to postgres;
commit;
