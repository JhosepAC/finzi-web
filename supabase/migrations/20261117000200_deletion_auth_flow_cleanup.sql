-- Auth's hard-delete endpoint can leave PKCE flow_state rows without an Auth FK.
-- Preserve all existing checkpoints/verification; purge only after Auth is absent,
-- under the subject's valid receipt lease. No public or financial permissions added.
begin;
alter function ops.deletion_step(uuid,text,text,text) rename to deletion_step_before_auth_flow_cleanup;
revoke all on function ops.deletion_step_before_auth_flow_cleanup(uuid,text,text,text) from public,anon,authenticated,finzi_deletion_worker,finzi_deletion_gateway;
create function ops.deletion_step(p_id uuid,p_lease text,p_action text,p_digest text default null)
returns void language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 if p_action='complete' and exists(select 1 from ops.deletion_receipts where id=p_id and stage='identity_pending') then
  select s.user_id into subject from ops.deletion_subjects s join ops.deletion_receipts r on r.id=s.receipt_id
  where r.id=p_id and r.lease_hash=sha256(convert_to(p_lease,'UTF8')) and r.lease_until>clock_timestamp()
   and not exists(select 1 from ops.cloud_deletion_jobs where receipt_id=p_id) for update of r;
  if not found then raise insufficient_privilege;end if;
  if exists(select 1 from auth.users where id=subject) then raise check_violation;end if;
  delete from auth.flow_state where user_id=subject;
 end if;
 perform ops.deletion_step_before_auth_flow_cleanup(p_id,p_lease,p_action,p_digest);
end $$;
revoke all on function ops.deletion_step(uuid,text,text,text) from public,anon,authenticated,finzi_deletion_gateway;
grant execute on function ops.deletion_step(uuid,text,text,text) to finzi_deletion_worker;

alter function ops.cloud_deletion_step(uuid,text,text,text) rename to cloud_deletion_step_before_auth_flow_cleanup;
revoke all on function ops.cloud_deletion_step_before_auth_flow_cleanup(uuid,text,text,text) from public,anon,authenticated,finzi_deletion_worker,finzi_deletion_gateway;
create function ops.cloud_deletion_step(p_id uuid,p_lease text,p_action text,p_digest text default null)
returns void language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 if p_action='auth' and exists(select 1 from ops.cloud_deletion_jobs where receipt_id=p_id and state='DATABASE_PURGED') then
  select s.user_id into subject from ops.deletion_subjects s join ops.deletion_receipts r on r.id=s.receipt_id
   join ops.cloud_deletion_jobs c on c.receipt_id=r.id
  where r.id=p_id and not c.halted and r.lease_hash=sha256(convert_to(p_lease,'UTF8')) and r.lease_until>clock_timestamp() for update of r;
  if not found then raise insufficient_privilege;end if;
  if exists(select 1 from auth.users where id=subject) then raise check_violation;end if;
  delete from auth.flow_state where user_id=subject;
 end if;
 perform ops.cloud_deletion_step_before_auth_flow_cleanup(p_id,p_lease,p_action,p_digest);
end $$;
revoke all on function ops.cloud_deletion_step(uuid,text,text,text) from public,anon,authenticated,finzi_deletion_worker;
grant execute on function ops.cloud_deletion_step(uuid,text,text,text) to finzi_deletion_gateway;
commit;
