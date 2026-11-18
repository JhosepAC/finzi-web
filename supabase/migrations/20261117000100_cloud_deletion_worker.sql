-- Phase 4. Additive cloud transport; the local Node executable remains unchanged.
begin;
-- Migration-only membership to replace the existing worker-owned claim function.
-- The maintenance executor must have ADMIN on this role; never grant it to the gateway.
grant finzi_deletion_worker to postgres;
create role finzi_deletion_gateway login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant usage on schema ops to finzi_deletion_gateway;

create table ops.deletion_runtime_settings(singleton boolean primary key check(singleton),cloud_enabled boolean not null default false);
insert into ops.deletion_runtime_settings values(true,false);
create table ops.cloud_deletion_jobs(
 receipt_id uuid primary key references ops.deletion_receipts(id),
 state text not null default 'PENDING' check(state in ('PENDING','PROCESSING','STORAGE_PURGED','DATABASE_PURGED','AUTH_PURGED','VERIFIED','COMPLETED')),
 version integer not null default 0,attempts integer not null default 0 check(attempts between 0 and 8),
 pending_files bigint check(pending_files>=0),
 halted boolean not null default false,error_code text check(error_code in ('manifest','storage','database','auth','verification','timeout')),
 updated_at timestamptz not null default now()
);
create table ops.deletion_transport_peers(
 receipt_id uuid not null references ops.deletion_receipts(id),bot_id text not null,telegram_user_id text not null,
 primary key(receipt_id,bot_id,telegram_user_id)
);
alter table ops.deletion_runtime_settings owner to postgres;
alter table ops.cloud_deletion_jobs owner to postgres;
alter table ops.deletion_transport_peers owner to postgres;
do $$ declare t text; begin
 foreach t in array array['deletion_runtime_settings','cloud_deletion_jobs','deletion_transport_peers'] loop
  execute format('alter table ops.%I enable row level security',t);
  execute format('alter table ops.%I force row level security',t);
  execute format('revoke all on ops.%I from public,anon,authenticated,finzi_deletion_gateway,finzi_deletion_worker',t);
  execute format('create policy operator_only on ops.%I for all to postgres using(true) with check(true)',t);
 end loop;
end $$;

create function ops.assign_cloud_deletion() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.stage='requested' and (select cloud_enabled from ops.deletion_runtime_settings where singleton) then
  insert into ops.cloud_deletion_jobs(receipt_id) values(new.id) on conflict do nothing;
 end if;
 if tg_op='UPDATE' and new.stage='requested' and old.stage<>'requested' then
  update ops.cloud_deletion_jobs set state='PENDING',attempts=0,pending_files=null,halted=false,error_code=null,version=version+1,updated_at=clock_timestamp() where receipt_id=new.id;
 end if;
 return new;
end $$;
create trigger cloud_deletion_assignment after insert or update of stage on ops.deletion_receipts for each row execute function ops.assign_cloud_deletion();

-- A valid residual JWT must not recreate files while blocked or after Auth removal.
create function ops.storage_subject_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from finance.profiles p join auth.users a on a.id=p.user_id where p.user_id=auth.uid()
  and not exists(select 1 from ops.deletion_blocks b where b.user_id=p.user_id));
$$;
revoke all on function ops.storage_subject_active() from public,anon,authenticated;
grant execute on function ops.storage_subject_active() to authenticated;
alter policy category_images_select on storage.objects using(bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid()::text) and (select ops.storage_subject_active()));
alter policy category_images_insert on storage.objects with check(bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid()::text) and (select ops.storage_subject_active()));
alter policy category_images_update on storage.objects using(bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid()::text) and (select ops.storage_subject_active())) with check(bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid()::text) and (select ops.storage_subject_active()));
alter policy category_images_delete on storage.objects using(bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid()::text) and (select ops.storage_subject_active()));

create function ops.deletion_remaining(p_subject uuid,p_receipt uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; found_row boolean; remaining integer:=0; auth_rows integer:=0;
begin
 for r in select n.nspname,c.relname,a.atttypid from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
  where n.nspname in ('finance','telegram_private','auth') and c.relkind='r' and a.attname='user_id' and not a.attisdropped loop
  -- Cast the parameter, never the indexed column. Auth refresh_tokens uses varchar.
  if r.atttypid='uuid'::regtype then
   execute format('select exists(select 1 from %I.%I where user_id=$1)',r.nspname,r.relname) into found_row using p_subject;
  elsif r.atttypid in ('text'::regtype,'varchar'::regtype) then
   execute format('select exists(select 1 from %I.%I where user_id=$1)',r.nspname,r.relname) into found_row using p_subject::text;
  else raise check_violation;end if;
  if found_row then if r.nspname='auth' then auth_rows:=auth_rows+1; else remaining:=remaining+1; end if;end if;
 end loop;
 return jsonb_build_object('database',remaining,'auth',auth_rows+case when exists(select 1 from auth.users where id=p_subject) then 1 else 0 end,
  'storage',(select count(*) from storage.objects where owner_id=p_subject::text or owner=p_subject or split_part(name,'/',1)=p_subject::text),
  'transport',(select count(*) from telegram_private.transport_events e join ops.deletion_transport_peers p on p.bot_id=e.bot_id and p.telegram_user_id=e.telegram_user_id where p.receipt_id=p_receipt)
    +(select count(*) from telegram_private.transport_credentials e join ops.deletion_transport_peers p on p.bot_id=e.bot_id and p.telegram_user_id=e.telegram_user_id where p.receipt_id=p_receipt));
end $$;

create function ops.capture_deletion_peers(p_receipt uuid,p_subject uuid) returns void language sql security definer set search_path='' as $$
 insert into ops.deletion_transport_peers
 select p_receipt,bot_id,telegram_user_id from telegram_private.links where user_id=p_subject
 union select p_receipt,bot_id,telegram_user_id from telegram_private.link_attempts where user_id=p_subject and telegram_user_id is not null
 on conflict do nothing;
$$;
create function ops.purge_deletion_transport(p_receipt uuid,p_subject uuid) returns void language plpgsql security definer set search_path='' as $$
declare b text;
begin
 perform ops.capture_deletion_peers(p_receipt,p_subject);
 for b in select distinct bot_id from ops.deletion_transport_peers where receipt_id=p_receipt order by bot_id loop
  if not pg_try_advisory_xact_lock(hashtextextended('finzi-telegram:'||b,0)) then raise lock_not_available;end if;
 end loop;
 delete from telegram_private.transport_events e using ops.deletion_transport_peers p where p.receipt_id=p_receipt and p.bot_id=e.bot_id and p.telegram_user_id=e.telegram_user_id;
 delete from telegram_private.transport_credentials e using ops.deletion_transport_peers p where p.receipt_id=p_receipt and p.bot_id=e.bot_id and p.telegram_user_id=e.telegram_user_id;
end $$;
create function ops.fence_deleting_transport() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from ops.deletion_transport_peers p join ops.deletion_receipts r on r.id=p.receipt_id where p.bot_id=new.bot_id and p.telegram_user_id=new.telegram_user_id and r.stage<>'completed') then raise insufficient_privilege;end if;
 return new;
end $$;
create trigger deletion_fence_events before insert on telegram_private.transport_events for each row execute function ops.fence_deleting_transport();
create trigger deletion_fence_credentials before insert on telegram_private.transport_credentials for each row execute function ops.fence_deleting_transport();

create function ops.cloud_deletion_assigned(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from ops.cloud_deletion_jobs where receipt_id=p_id);
$$;

-- Preserve legacy SQL signatures and Node code; cloud-assigned jobs cannot be stolen.
alter function ops.deletion_step(uuid,text,text,text) rename to deletion_step_before_cloud;
revoke all on function ops.deletion_step_before_cloud(uuid,text,text,text) from public,anon,authenticated,finzi_deletion_worker;
create function ops.deletion_step(p_id uuid,p_lease text,p_action text,p_digest text default null) returns void language plpgsql security definer set search_path='' as $$
declare subject uuid; r jsonb;
begin
 if exists(select 1 from ops.cloud_deletion_jobs where receipt_id=p_id) then raise insufficient_privilege;end if;
 select s.user_id into subject from ops.deletion_subjects s join ops.deletion_receipts d on d.id=s.receipt_id where d.id=p_id and d.lease_hash=sha256(convert_to(p_lease,'UTF8')) and d.lease_until>clock_timestamp() for update of d;
 if not found then raise insufficient_privilege;end if;
 if p_action='purge' then perform ops.purge_deletion_transport(p_id,subject);end if;
 if p_action='complete' then
  r:=ops.deletion_remaining(subject,p_id);
  if r<>jsonb_build_object('database',0,'auth',0,'storage',0,'transport',0) then raise check_violation;end if;
  delete from ops.deletion_transport_peers where receipt_id=p_id;
 end if;
 perform ops.deletion_step_before_cloud(p_id,p_lease,p_action,p_digest);
end $$;
create or replace function ops.claim_deletion() returns jsonb language plpgsql security definer set search_path='' as $$
declare target ops.deletion_receipts%rowtype; subject uuid; token text;
begin
 select r.* into target from ops.deletion_receipts r join ops.deletion_subjects s on s.receipt_id=r.id
 where r.stage<>'completed' and not ops.cloud_deletion_assigned(r.id)
 and (r.next_retry_at is null or r.next_retry_at<=clock_timestamp()) and (r.lease_until is null or r.lease_until<clock_timestamp())
 order by r.created_at,r.id limit 1 for update of r skip locked;
 if not found then return null;end if;
 select user_id into subject from ops.deletion_subjects where receipt_id=target.id;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 update ops.deletion_receipts set lease_hash=sha256(convert_to(token,'UTF8')),lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,next_retry_at=null,updated_at=clock_timestamp() where id=target.id;
 return jsonb_build_object('id',target.id,'user_id',subject,'tracking_hash',encode(target.tracking_hash,'hex'),'lease',token,'stage',target.stage);
end $$;

create function ops.cloud_deletion_claim(p_lease text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r ops.deletion_receipts%rowtype; subject uuid; phase text; exhausted uuid;
begin
 if p_lease is null or p_lease!~'^[a-f0-9]{64}$' then raise check_violation;end if;
 -- Even a crash on the final attempt becomes a visible halt, without retrying it.
 select d.id into exhausted from ops.deletion_receipts d join ops.cloud_deletion_jobs c on c.receipt_id=d.id
 where not c.halted and c.attempts>=8 and c.state<>'COMPLETED' and (d.lease_until is null or d.lease_until<=clock_timestamp())
 order by d.created_at,d.id for update of d skip locked limit 1;
 if found then
  update ops.cloud_deletion_jobs set halted=true,error_code='timeout',updated_at=clock_timestamp() where receipt_id=exhausted;
  update ops.deletion_receipts set lease_hash=null,lease_until=null,updated_at=clock_timestamp() where id=exhausted;
 end if;
 select d.* into r from ops.deletion_receipts d join ops.cloud_deletion_jobs c on c.receipt_id=d.id join ops.deletion_subjects s on s.receipt_id=d.id
 where d.stage<>'completed' and c.state<>'COMPLETED' and not c.halted and c.attempts<8 and (d.next_retry_at is null or d.next_retry_at<=clock_timestamp())
 and (d.lease_until is null or d.lease_until<=clock_timestamp()) order by d.created_at,d.id for update of d skip locked limit 1;
 if not found then return null;end if;
 select user_id into subject from ops.deletion_subjects where receipt_id=r.id;
 if not exists(select 1 from ops.deletion_blocks where user_id=subject) then raise check_violation;end if;
 update ops.cloud_deletion_jobs set pending_files=case when state='PENDING' then (ops.deletion_remaining(subject,r.id)->>'storage')::bigint else pending_files end,
 state=case when state='PENDING' then 'PROCESSING' else state end,attempts=attempts+1,updated_at=clock_timestamp() where receipt_id=r.id returning state into phase;
 update ops.deletion_receipts set lease_hash=sha256(convert_to(p_lease,'UTF8')),lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,next_retry_at=null,updated_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('id',r.id,'user_id',subject,'tracking_hash',encode(r.tracking_hash,'hex'),'lease',p_lease,'state',phase,'manifest_digest',r.manifest_digest);
end $$;
create function ops.cloud_deletion_lock(p_id uuid,p_lease text) returns uuid language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 if p_lease is null or p_lease!~'^[a-f0-9]{64}$' then raise insufficient_privilege;end if;
 select s.user_id into subject from ops.deletion_receipts r join ops.deletion_subjects s on s.receipt_id=r.id join ops.cloud_deletion_jobs c on c.receipt_id=r.id
 where r.id=p_id and r.stage<>'completed' and c.state<>'COMPLETED' and not c.halted and r.lease_hash=sha256(convert_to(p_lease,'UTF8')) and r.lease_until>clock_timestamp()+interval '45 seconds' for update of r;
 if not found or not exists(select 1 from ops.deletion_blocks where user_id=subject) then raise insufficient_privilege;end if;
 return subject;
end $$;
create function ops.cloud_deletion_inspect(p_id uuid,p_lease text) returns jsonb language plpgsql security definer set search_path='' as $$
declare subject uuid; bucket text;
begin
 subject:=ops.cloud_deletion_lock(p_id,p_lease);
 select bucket_id into bucket from storage.objects where owner_id=subject::text or owner=subject or split_part(name,'/',1)=subject::text order by bucket_id,name limit 1;
 return ops.deletion_remaining(subject,p_id)||jsonb_build_object('files',(select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)),'[]') from
  (select bucket_id,name from storage.objects where bucket_id=bucket and (owner_id=subject::text or owner=subject or split_part(name,'/',1)=subject::text) order by name limit 50) f));
end $$;
create function ops.cloud_deletion_step(p_id uuid,p_lease text,p_action text,p_digest text default null) returns void language plpgsql security definer set search_path='' as $$
declare subject uuid; c ops.cloud_deletion_jobs%rowtype; r ops.deletion_receipts%rowtype; remaining jsonb; next_state text;
begin
 subject:=ops.cloud_deletion_lock(p_id,p_lease);
 select * into c from ops.cloud_deletion_jobs where receipt_id=p_id;
 select * into r from ops.deletion_receipts where id=p_id;
 next_state:=c.state;
 if p_action='manifest' then
  if c.state<>'PROCESSING' or p_digest is null or p_digest!~'^[a-f0-9]{64}$' or (r.manifest_digest is not null and r.manifest_digest<>p_digest) then raise check_violation;end if;
  perform ops.capture_deletion_peers(p_id,subject);
  update ops.deletion_receipts set manifest_digest=p_digest where id=p_id;
 elsif p_action='yield' then
  remaining:=ops.deletion_remaining(subject,p_id);
  if c.state<>'PROCESSING' or r.manifest_digest is null or c.pending_files is null
   or (remaining->>'storage')::bigint<=0 or (remaining->>'storage')::bigint>=c.pending_files then raise check_violation;end if;
  update ops.cloud_deletion_jobs set pending_files=(remaining->>'storage')::bigint where receipt_id=p_id;
 elsif p_action='storage' then
  remaining:=ops.deletion_remaining(subject,p_id);
  if c.state<>'PROCESSING' or r.manifest_digest is null or (remaining->>'storage')::integer<>0 then raise check_violation;end if;
  next_state:='STORAGE_PURGED';
 elsif p_action='database' then
  if c.state<>'STORAGE_PURGED' or r.manifest_digest is null then raise check_violation;end if;
  if (ops.deletion_remaining(subject,p_id)->>'storage')::integer<>0 then raise check_violation;end if;
  perform ops.purge_deletion_transport(p_id,subject);
  perform ops.deletion_step_before_cloud(p_id,p_lease,'purge');
  if (ops.deletion_remaining(subject,p_id)->>'database')::integer<>0 then raise check_violation;end if;
  next_state:='DATABASE_PURGED';
 elsif p_action='auth' then
  if c.state<>'DATABASE_PURGED' or (ops.deletion_remaining(subject,p_id)->>'auth')::integer<>0 then raise check_violation;end if;
  next_state:='AUTH_PURGED';
 elsif p_action in ('verify','complete') then
  if (p_action='verify' and c.state<>'AUTH_PURGED') or (p_action='complete' and c.state<>'VERIFIED') then raise check_violation;end if;
  if p_digest is null or p_digest is distinct from r.manifest_digest then raise check_violation;end if;
  remaining:=ops.deletion_remaining(subject,p_id);
  if remaining<>jsonb_build_object('database',0,'auth',0,'storage',0,'transport',0) then raise check_violation;end if;
  if p_action='complete' then
   delete from ops.deletion_transport_peers where receipt_id=p_id;
   perform ops.deletion_step_before_cloud(p_id,p_lease,'complete');next_state:='COMPLETED';
  else next_state:='VERIFIED';end if;
 else raise check_violation;end if;
 update ops.cloud_deletion_jobs set state=next_state,version=version+1,attempts=0,error_code=null,updated_at=clock_timestamp() where receipt_id=p_id;
 update ops.deletion_receipts set lease_hash=null,lease_until=null,next_retry_at=null,error_code=null,updated_at=clock_timestamp() where id=p_id;
end $$;
create function ops.cloud_deletion_fail(p_id uuid,p_lease text,p_code text) returns void language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform ops.cloud_deletion_lock(p_id,p_lease);
 if p_code is null or p_code not in ('manifest','storage','database','auth','verification','timeout') then raise check_violation;end if;
 update ops.cloud_deletion_jobs set error_code=p_code,halted=attempts>=8,updated_at=clock_timestamp() where receipt_id=p_id returning attempts into n;
 update ops.deletion_receipts set lease_hash=null,lease_until=null,next_retry_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,n)::integer)),updated_at=clock_timestamp() where id=p_id;
end $$;

-- All operational entrypoints are private. No new API schema RPC or app grants.
do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ops' and p.proname in
 ('assign_cloud_deletion','deletion_remaining','capture_deletion_peers','purge_deletion_transport','fence_deleting_transport','cloud_deletion_assigned','cloud_deletion_claim','cloud_deletion_lock','cloud_deletion_inspect','cloud_deletion_step','cloud_deletion_fail','deletion_step') loop
  execute format('revoke all on function %s from public,anon,authenticated,finzi_deletion_gateway,finzi_deletion_worker',f);
  execute format('alter function %s owner to postgres',f);
 end loop;
end $$;
alter function ops.storage_subject_active() owner to postgres;
grant execute on function ops.claim_deletion(),ops.deletion_step(uuid,text,text,text) to finzi_deletion_worker;
grant execute on function ops.cloud_deletion_assigned(uuid) to finzi_deletion_worker;
grant execute on function ops.cloud_deletion_claim(text),ops.cloud_deletion_inspect(uuid,text),ops.cloud_deletion_step(uuid,text,text,text),ops.cloud_deletion_fail(uuid,text,text) to finzi_deletion_gateway;
revoke finzi_deletion_worker from postgres;
commit;
