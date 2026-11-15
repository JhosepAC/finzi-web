-- A-10: private portability and durable deletion requests. No application admin key.
grant app_executor to postgres;
create schema if not exists ops;
revoke all on schema ops from public,anon,authenticated;
create role finzi_deletion_worker nologin noinherit nobypassrls;
grant usage on schema ops,finance to finzi_deletion_worker;
grant usage on schema ops to app_executor;
alter table finance.reauth_proofs drop constraint reauth_proofs_purpose_check;
alter table finance.reauth_proofs add constraint reauth_proofs_purpose_check check(purpose in ('change_password','export_data','delete_account'));
create or replace function api.issue_reauth_proof(p_purpose text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id(); claims jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 sid uuid; token text; issued timestamptz:=clock_timestamp();
begin
 if owned is null or (p_purpose is null or p_purpose not in ('change_password','export_data','delete_account')) or claims->>'session_id' is null
   or (claims->>'session_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(claims->'amr') is distinct from 'array' then raise insufficient_privilege; end if;
 if not exists(select 1 from jsonb_array_elements(claims->'amr') a where a->>'method'='password'
   and case when (a->>'timestamp') ~ '^[0-9]{1,12}$' then (a->>'timestamp')::numeric<=extract(epoch from issued)
     and extract(epoch from issued)-(a->>'timestamp')::numeric<=300 else false end) then raise insufficient_privilege; end if;
 sid:=(claims->>'session_id')::uuid;
 perform 1 from finance.profiles where user_id=owned for update; if not found then raise insufficient_privilege; end if;
 delete from finance.reauth_proofs where user_id=owned and (expires_at<=issued or consumed_at is not null);
 if not exists(select 1 from finance.reauth_proofs where user_id=owned and session_id=sid and purpose=p_purpose)
    and (select count(*) from finance.reauth_proofs where user_id=owned)>=20 then raise program_limit_exceeded; end if;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into finance.reauth_proofs(user_id,session_id,purpose,token_hash,created_at,expires_at,consumed_at)
  values(owned,sid,p_purpose,sha256(convert_to(token,'UTF8')),issued,issued+interval '5 minutes',null)
  on conflict(user_id,session_id,purpose) do update set token_hash=excluded.token_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,consumed_at=null;
 return jsonb_build_object('token',token,'expires_at',issued+interval '5 minutes');
end $$;
create or replace function api.consume_reauth_proof(p_token text,p_purpose text) returns boolean language plpgsql security definer set search_path='' as $$
declare claims jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb; consumed boolean;
begin
 if finance.request_user_id() is null then raise insufficient_privilege; end if;
 if (p_purpose is null or p_purpose not in ('change_password','export_data','delete_account')) or p_token is null or p_token !~ '^[a-f0-9]{64}$' then return false; end if;
 update finance.reauth_proofs set consumed_at=clock_timestamp() where user_id=finance.request_user_id() and session_id::text=claims->>'session_id'
  and purpose=p_purpose and token_hash=sha256(convert_to(p_token,'UTF8')) and consumed_at is null and expires_at>clock_timestamp() returning true into consumed;
 return coalesce(consumed,false);
end $$;

create table ops.deletion_receipts(
 id uuid primary key,tracking_hash bytea not null check(octet_length(tracking_hash)=32),
 stage text not null default 'requested' check(stage in ('requested','identity_pending','completed')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,
 lease_hash bytea,lease_until timestamptz,attempts integer not null default 0,next_retry_at timestamptz,
 error_code text check(error_code in ('manifest_unavailable','database_unavailable','auth_unavailable')),
 manifest_digest text check(manifest_digest ~ '^[a-f0-9]{64}$')
);
create table ops.deletion_subjects(user_id uuid primary key,receipt_id uuid not null unique references ops.deletion_receipts(id));
create table ops.deletion_blocks(user_id uuid primary key);
create function finance.raw_request_user_id() returns uuid language sql stable security definer set search_path='' as $$ select auth.uid(); $$;
revoke all on function finance.raw_request_user_id() from public,anon,authenticated;
grant execute on function finance.raw_request_user_id() to app_executor;
-- Narrow lookup only; a queued subject cannot use a still-valid JWT to access finances.
create or replace function finance.request_user_id() returns uuid language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from ops.deletion_blocks where user_id=auth.uid()) then null else auth.uid() end;
$$;
revoke all on function finance.request_user_id() from public,anon,authenticated;
grant execute on function finance.request_user_id() to app_executor;
alter table ops.deletion_receipts enable row level security;
alter table ops.deletion_receipts force row level security;
revoke all on ops.deletion_receipts from public,anon,authenticated;
grant select,insert,update,delete on ops.deletion_receipts to finzi_deletion_worker;
create policy deletion_receipts_worker on ops.deletion_receipts for all to finzi_deletion_worker using(true) with check(true);
create policy deletion_receipts_operator on ops.deletion_receipts for all to postgres using(true) with check(true);
alter table ops.deletion_subjects enable row level security;
alter table ops.deletion_subjects force row level security;
revoke all on ops.deletion_subjects from public,anon,authenticated;
grant select,insert,update,delete on ops.deletion_subjects to finzi_deletion_worker;
create policy deletion_subjects_worker on ops.deletion_subjects for all to finzi_deletion_worker using(true) with check(true);
create policy deletion_subjects_operator on ops.deletion_subjects for all to postgres using(true) with check(true);
alter table ops.deletion_blocks enable row level security;
alter table ops.deletion_blocks force row level security;
revoke all on ops.deletion_blocks from public,anon,authenticated;
grant select,insert,update,delete on ops.deletion_blocks to finzi_deletion_worker;
create policy deletion_blocks_worker on ops.deletion_blocks for all to finzi_deletion_worker using(true) with check(true);
create policy deletion_blocks_operator on ops.deletion_blocks for all to postgres using(true) with check(true);
grant select,insert on ops.deletion_receipts,ops.deletion_subjects,ops.deletion_blocks to app_executor;
create policy receipts_own on ops.deletion_receipts for select to app_executor using(exists(select 1 from ops.deletion_subjects s where s.receipt_id=id and s.user_id=finance.raw_request_user_id()));
create policy receipts_insert on ops.deletion_receipts for insert to app_executor with check(true);
create policy subjects_own on ops.deletion_subjects for select to app_executor using(user_id=finance.raw_request_user_id());
create policy subjects_insert on ops.deletion_subjects for insert to app_executor with check(user_id=finance.raw_request_user_id());
create policy blocks_own on ops.deletion_blocks for select to app_executor using(user_id=finance.raw_request_user_id());
create policy blocks_insert on ops.deletion_blocks for insert to app_executor with check(user_id=finance.raw_request_user_id());

grant select,delete on finance.profiles to finzi_deletion_worker;
create policy profiles_cleanup_read on finance.profiles for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=profiles.user_id));
create policy profiles_cleanup_delete on finance.profiles for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=profiles.user_id));

create function api.read_data_proof(p_token text,p_purpose text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('expires_at',expires_at) from finance.reauth_proofs where user_id=finance.request_user_id()
 and session_id::text=(nullif(current_setting('request.jwt.claims',true),'')::jsonb)->>'session_id'
 and purpose=p_purpose and p_purpose in ('export_data','delete_account') and p_token ~ '^[a-f0-9]{64}$'
 and token_hash=sha256(convert_to(p_token,'UTF8')) and consumed_at is null and expires_at>statement_timestamp();
$$;
create function api.request_deletion(p_request_id uuid,p_tracking_token text,p_proof text,p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=finance.raw_request_user_id(); existing uuid; tracking bytea;
begin
 if owned is null then raise insufficient_privilege; end if;
 if p_request_id is null or p_tracking_token is null or p_tracking_token !~ '^[a-f0-9]{64}$' or p_confirmation is distinct from 'ELIMINAR' then raise check_violation; end if;
 tracking:=sha256(convert_to(p_tracking_token,'UTF8'));
 select receipt_id into existing from ops.deletion_subjects where user_id=owned;
 if found then
  if existing=p_request_id and exists(select 1 from ops.deletion_receipts where id=existing and tracking_hash=tracking) then return jsonb_build_object('id',existing,'accepted',true); end if;
  raise serialization_failure;
 end if;
 perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
 if not found then raise insufficient_privilege; end if;
 -- Recheck after waiting for the shared per-user financial lock.
 select receipt_id into existing from ops.deletion_subjects where user_id=owned;
 if found then
  if existing=p_request_id and exists(select 1 from ops.deletion_receipts where id=existing and tracking_hash=tracking) then return jsonb_build_object('id',existing,'accepted',true); end if;
  raise serialization_failure;
 end if;
 if not api.consume_reauth_proof(p_proof,'delete_account') then raise insufficient_privilege; end if;
 insert into ops.deletion_receipts(id,tracking_hash) values(p_request_id,tracking);
 insert into ops.deletion_subjects(user_id,receipt_id) values(owned,p_request_id);
 insert into ops.deletion_blocks(user_id) values(owned);
 return jsonb_build_object('id',p_request_id,'accepted',true);
end $$;
-- Tracking has no user data and needs the unguessable bearer receipt after Auth is gone.
create function api.deletion_status(p_id uuid,p_tracking_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'status',case when stage='completed' then 'completed' when attempts=0 then 'requested' else 'processing' end,
 'created_at',created_at,'updated_at',updated_at,'completed_at',completed_at,'retry_pending',next_retry_at is not null)
 from ops.deletion_receipts where id=p_id and p_tracking_token ~ '^[a-f0-9]{64}$' and tracking_hash=sha256(convert_to(p_tracking_token,'UTF8'));
$$;
revoke all on function api.deletion_status(uuid,text) from public,anon,authenticated;
grant execute on function api.deletion_status(uuid,text) to anon,authenticated;

create function ops.claim_deletion() returns jsonb language plpgsql security definer set search_path='' as $$
declare target ops.deletion_receipts%rowtype; subject uuid; token text;
begin
 select r.* into target from ops.deletion_receipts r join ops.deletion_subjects s on s.receipt_id=r.id
 where r.stage<>'completed' and (r.next_retry_at is null or r.next_retry_at<=clock_timestamp()) and (r.lease_until is null or r.lease_until<clock_timestamp())
 order by r.created_at,r.id limit 1 for update of r skip locked;
 if not found then return null; end if;
 select user_id into subject from ops.deletion_subjects where receipt_id=target.id;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 update ops.deletion_receipts set lease_hash=sha256(convert_to(token,'UTF8')),lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,next_retry_at=null,updated_at=clock_timestamp() where id=target.id;
 return jsonb_build_object('id',target.id,'user_id',subject,'tracking_hash',encode(target.tracking_hash,'hex'),'lease',token,'stage',target.stage);
end $$;
create function ops.deletion_step(p_id uuid,p_lease text,p_action text,p_digest text default null) returns void language plpgsql security definer set search_path='' as $$
declare subject uuid; receipt ops.deletion_receipts%rowtype;
begin
 select * into receipt from ops.deletion_receipts where id=p_id and lease_hash=sha256(convert_to(p_lease,'UTF8')) and lease_until>clock_timestamp() and stage<>'completed' for update;
 if not found then raise insufficient_privilege; end if;
 select user_id into subject from ops.deletion_subjects where receipt_id=p_id; if not found then raise check_violation; end if;
 if p_action='manifest' then
  if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise check_violation; end if;
  update ops.deletion_receipts set manifest_digest=p_digest,updated_at=clock_timestamp() where id=p_id;
 elsif p_action='purge' then
  if receipt.manifest_digest is null then raise check_violation; end if;
  -- This function belongs to postgres and is worker-only: no user-controlled subject argument.
  delete from auth.sessions where user_id=subject;
  perform ops.purge_profile(p_id,p_lease);
  update ops.deletion_receipts set stage='identity_pending',updated_at=clock_timestamp() where id=p_id;
 elsif p_action='complete' then
  if receipt.manifest_digest is null or receipt.stage<>'identity_pending' or exists(select 1 from auth.users where id=subject) then raise check_violation; end if;
  update ops.deletion_receipts set stage='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp(),lease_hash=null,lease_until=null,error_code=null,next_retry_at=null where id=p_id;
  delete from ops.deletion_subjects where receipt_id=p_id;
  delete from ops.deletion_blocks where user_id=subject;
 elsif p_action in ('manifest_unavailable','database_unavailable','auth_unavailable') then
  update ops.deletion_receipts set error_code=p_action,next_retry_at=clock_timestamp()+interval '15 seconds',lease_hash=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
 else raise check_violation;
 end if;
end $$;
create function ops.restore_deletion(p_id uuid,p_subject uuid,p_tracking_hash text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_id is null or p_subject is null or p_tracking_hash is null or p_tracking_hash !~ '^[a-f0-9]{64}$' then raise check_violation; end if;
 if not exists(select 1 from auth.users where id=p_subject) then return false; end if;
 insert into ops.deletion_receipts(id,tracking_hash) values(p_id,decode(p_tracking_hash,'hex')) on conflict(id) do nothing;
 if not exists(select 1 from ops.deletion_receipts where id=p_id and tracking_hash=decode(p_tracking_hash,'hex')) then raise check_violation; end if;
 insert into ops.deletion_subjects(user_id,receipt_id) values(p_subject,p_id) on conflict(user_id) do nothing;
 if not exists(select 1 from ops.deletion_subjects where user_id=p_subject and receipt_id=p_id) then raise check_violation; end if;
 insert into ops.deletion_blocks(user_id) values(p_subject) on conflict(user_id) do nothing;
 update ops.deletion_receipts set stage='requested',completed_at=null,lease_hash=null,lease_until=null,next_retry_at=null,updated_at=clock_timestamp() where id=p_id;
 return true;
end $$;
create function ops.purge_profile(p_id uuid,p_lease text) returns void language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 select s.user_id into subject from ops.deletion_subjects s join ops.deletion_receipts r on r.id=s.receipt_id where r.id=p_id
  and r.lease_hash=sha256(convert_to(p_lease,'UTF8')) and r.lease_until>clock_timestamp() and r.manifest_digest is not null and r.stage<>'completed';
 if not found then raise insufficient_privilege; end if;
 delete from finance.profiles where user_id=subject;
end $$;

create table finance.export_events(user_id uuid not null references finance.profiles(user_id) on delete cascade,created_at timestamptz not null default now());
create index export_events_owner_time on finance.export_events(user_id,created_at);
alter table finance.export_events enable row level security;
alter table finance.export_events force row level security;
revoke all on finance.export_events from public,anon,authenticated;
grant select,insert,delete on finance.export_events to app_executor;
create policy export_read on finance.export_events for select to app_executor using(user_id=finance.request_user_id());
create policy export_insert on finance.export_events for insert to app_executor with check(user_id=finance.request_user_id());
create policy export_delete on finance.export_events for delete to app_executor using(user_id=finance.request_user_id());
create function api.export_personal_data(p_proof text,p_format text,p_currency text default 'PEN',p_kind text default null,p_account_id uuid default null,p_category_id uuid default null,
 p_from date default null,p_to date default null,p_query text default '',p_status text default 'all') returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id(); profile finance.profiles%rowtype; captured timestamptz; result jsonb;
begin
 if owned is null then raise insufficient_privilege; end if;
 select * into profile from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
 if not found then raise insufficient_privilege; end if;
 captured:=clock_timestamp();
 if p_format is null or p_format not in ('json','csv') or p_currency is null or p_currency not in ('PEN','USD')
  or (p_kind is not null and p_kind not in ('income','expense','transfer')) or p_status is null or p_status not in ('all','posted','void','replaced')
  or p_query is null or length(p_query)>200 or (p_from is not null and (not isfinite(p_from) or p_from<date '1900-01-01'))
  or (p_to is not null and not isfinite(p_to)) or (p_from is not null and p_to is not null and p_from>p_to) then raise check_violation; end if;
 if p_format='json' and (p_kind is not null or p_account_id is not null or p_category_id is not null or p_from is not null or p_to is not null or p_query<>'' or p_status<>'all') then raise check_violation; end if;
 if (p_account_id is not null and not exists(select 1 from finance.accounts where user_id=owned and id=p_account_id and currency_code=p_currency))
  or (p_category_id is not null and not exists(select 1 from finance.categories where user_id=owned and id=p_category_id)) then raise no_data_found; end if;
 delete from finance.export_events where user_id=owned and created_at<captured-interval '1 hour';
 if (select count(*) from finance.export_events where user_id=owned)>=3 then raise program_limit_exceeded; end if;
 if not api.consume_reauth_proof(p_proof,'export_data') then raise insufficient_privilege; end if;
 insert into finance.export_events(user_id,created_at) values(owned,captured);
 if p_format='csv' then
  return jsonb_build_object('format_version','finzi.movements/v1','exported_at',captured,'timezone',profile.timezone,'currency',p_currency,
   'movements',(select coalesce(jsonb_agg(to_jsonb(m)-'user_id' order by m.occurred_at desc,m.id desc),'[]'::jsonb) from finance.movement_details m
    where m.user_id=owned and m.currency_code=p_currency and (p_kind is null or m.kind=p_kind)
    and (p_account_id is null or m.account_id=p_account_id or m.destination_id=p_account_id)
    and (p_category_id is null or m.category_id=p_category_id or exists(select 1 from finance.categories c where c.user_id=owned and c.id=m.category_id and c.parent_id=p_category_id))
    and (p_status='all' or (p_status='replaced' and m.replaced_by_id is not null) or (p_status<>'replaced' and m.status=p_status))
    and (p_from is null or m.occurred_at>=(p_from::timestamp at time zone profile.timezone)) and (p_to is null or m.occurred_at<((p_to+1)::timestamp at time zone profile.timezone))
    and (p_query='' or strpos(lower(m.description||' '||m.note),lower(p_query))>0)));
 end if;
 result:=jsonb_build_object('format_version','finzi.personal-data/v1','exported_at',captured,'timezone',profile.timezone,
  'profile',jsonb_build_object('display_name',profile.display_name,'locale',profile.locale,'preferred_currency',profile.preferred_currency,'timezone',profile.timezone,'onboarding_completed_at',profile.onboarding_completed_at,'version',profile.version,'created_at',profile.created_at,'updated_at',profile.updated_at),
  'accounts',api.read_accounts(),
  'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'parent_id',parent_id,'kind',kind,'name',name,'description',description,'color',color,'icon',icon,'status',status,'version',version,'created_at',created_at,'updated_at',updated_at) order by id),'[]'::jsonb) from finance.categories where user_id=owned),
  'movements',(select coalesce(jsonb_agg(to_jsonb(m)-'user_id' order by m.occurred_at desc,m.id desc),'[]'::jsonb) from finance.movement_details m where m.user_id=owned),
  'entries',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'transaction_id',transaction_id,'account_id',account_id,'signed_minor',(signed_amount*100)::numeric(20,0)::text,'created_at',created_at) order by id),'[]'::jsonb) from finance.transaction_entries where user_id=owned),
  'transaction_events',(select coalesce(jsonb_agg(jsonb_build_object('transaction_id',transaction_id,'action',action,'version',version,'recorded_at',recorded_at) order by recorded_at,id),'[]'::jsonb) from finance.transaction_events where user_id=owned),
  'account_events',(select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'action',action,'version',version,'recorded_at',recorded_at) order by recorded_at,id),'[]'::jsonb) from finance.account_events where user_id=owned),
  'category_events',(select coalesce(jsonb_agg(jsonb_build_object('category_id',category_id,'action',action,'version',version,'recorded_at',recorded_at) order by recorded_at,id),'[]'::jsonb) from finance.category_events where user_id=owned),
  'profile_events',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'action',action,'previous_timezone',previous_timezone,'new_timezone',new_timezone,'previous_currency',previous_currency,'new_currency',new_currency,'recorded_at',recorded_at) order by version),'[]'::jsonb) from finance.profile_events where user_id=owned));
 return result;
end $$;

grant finzi_deletion_worker to postgres;
grant create on schema ops to finzi_deletion_worker;
alter function ops.claim_deletion() owner to finzi_deletion_worker;
alter function ops.purge_profile(uuid,text) owner to finzi_deletion_worker;
revoke create on schema ops from finzi_deletion_worker;
revoke all on function ops.claim_deletion(),ops.deletion_step(uuid,text,text,text),ops.purge_profile(uuid,text),ops.restore_deletion(uuid,uuid,text) from public,anon,authenticated,app_executor;
grant execute on function ops.claim_deletion(),ops.deletion_step(uuid,text,text,text),ops.purge_profile(uuid,text),ops.restore_deletion(uuid,uuid,text) to finzi_deletion_worker;
-- The operator-owned step can invoke only the bounded financial cleanup function.
grant execute on function ops.purge_profile(uuid,text) to postgres;
grant create on schema api to app_executor;
alter function api.read_data_proof(text,text) owner to app_executor;
alter function api.request_deletion(uuid,text,text,text) owner to app_executor;
alter function api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.read_data_proof(text,text),api.request_deletion(uuid,text,text,text),api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) from public,anon,authenticated;
grant execute on function api.read_data_proof(text,text),api.request_deletion(uuid,text,text,text),api.export_personal_data(text,text,text,text,uuid,uuid,date,date,text,text) to authenticated;
revoke finzi_deletion_worker from postgres;
revoke app_executor from postgres;
