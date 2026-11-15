grant app_executor,finzi_deletion_worker to postgres;
create or replace function ops.purge_profile(p_id uuid,p_lease text) returns void language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 select s.user_id into subject from ops.deletion_subjects s join ops.deletion_receipts r on r.id=s.receipt_id where r.id=p_id
  and r.lease_hash=sha256(convert_to(p_lease,'UTF8')) and r.lease_until>clock_timestamp() and r.manifest_digest is not null and r.stage<>'completed';
 if not found then raise insufficient_privilege; end if;
 delete from finance.debt_payments where user_id=subject;
 delete from finance.debt_events where user_id=subject;
 delete from finance.debts where user_id=subject;
 delete from finance.transaction_events where user_id=subject;
 delete from finance.transaction_entries where user_id=subject;
 delete from finance.transactions where user_id=subject;
 delete from finance.category_events where user_id=subject;
 delete from finance.account_events where user_id=subject;
 delete from finance.categories where user_id=subject;
 delete from finance.accounts where user_id=subject;
 delete from finance.profiles where user_id=subject;
end $$;
alter function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) rename to export_core_data;
alter function api.export_core_data(text,text,text,text,uuid,uuid,date,date,text,text) set schema finance;
revoke all on function finance.export_core_data(text,text,text,text,uuid,uuid,date,date,text,text) from public,anon,authenticated;
grant execute on function finance.export_core_data(text,text,text,text,uuid,uuid,date,date,text,text) to app_executor;
create function api.export_personal_data(p_proof text,p_format text,p_currency text default 'PEN',p_kind text default null,p_account_id uuid default null,p_category_id uuid default null,p_from date default null,p_to date default null,p_query text default '',p_status text default 'all') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=finance.export_core_data(p_proof,p_format,p_currency,p_kind,p_account_id,p_category_id,p_from,p_to,p_query,p_status);
 if p_format='json' then result:=result||jsonb_build_object('debts',(api.read_debts())->'debts','debt_events',(select coalesce(jsonb_agg(jsonb_build_object('debt_id',debt_id,'action',action,'recorded_at',recorded_at)),'[]') from finance.debt_events where user_id=finance.request_user_id()));end if;
 return result;
end $$;
grant create on schema api to app_executor;
alter function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) from public,anon,authenticated;
grant execute on function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) to authenticated;
revoke app_executor,finzi_deletion_worker from postgres;
