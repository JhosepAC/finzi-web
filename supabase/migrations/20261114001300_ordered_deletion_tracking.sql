-- Forward-only fix: public receipt tracking and ordered, bounded financial cleanup.
grant usage on schema api to anon;
grant finzi_deletion_worker to postgres;
grant select,delete on finance.transaction_events to finzi_deletion_worker;
create policy transaction_events_cleanup_read on finance.transaction_events for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=transaction_events.user_id));
create policy transaction_events_cleanup_delete on finance.transaction_events for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=transaction_events.user_id));
grant select,delete on finance.transaction_entries to finzi_deletion_worker;
create policy transaction_entries_cleanup_read on finance.transaction_entries for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=transaction_entries.user_id));
create policy transaction_entries_cleanup_delete on finance.transaction_entries for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=transaction_entries.user_id));
grant select,delete on finance.transactions to finzi_deletion_worker;
create policy transactions_cleanup_read on finance.transactions for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=transactions.user_id));
create policy transactions_cleanup_delete on finance.transactions for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=transactions.user_id));
grant select,delete on finance.category_events to finzi_deletion_worker;
create policy category_events_cleanup_read on finance.category_events for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=category_events.user_id));
create policy category_events_cleanup_delete on finance.category_events for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=category_events.user_id));
grant select,delete on finance.account_events to finzi_deletion_worker;
create policy account_events_cleanup_read on finance.account_events for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=account_events.user_id));
create policy account_events_cleanup_delete on finance.account_events for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=account_events.user_id));
grant select,delete on finance.categories to finzi_deletion_worker;
create policy categories_cleanup_read on finance.categories for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=categories.user_id));
create policy categories_cleanup_delete on finance.categories for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=categories.user_id));
grant select,delete on finance.accounts to finzi_deletion_worker;
create policy accounts_cleanup_read on finance.accounts for select to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=accounts.user_id));
create policy accounts_cleanup_delete on finance.accounts for delete to finzi_deletion_worker using(exists(select 1 from ops.deletion_subjects s where s.user_id=accounts.user_id));
create or replace function ops.purge_profile(p_id uuid,p_lease text) returns void language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 select s.user_id into subject from ops.deletion_subjects s join ops.deletion_receipts r on r.id=s.receipt_id where r.id=p_id
  and r.lease_hash=sha256(convert_to(p_lease,'UTF8')) and r.lease_until>clock_timestamp() and r.manifest_digest is not null and r.stage<>'completed';
 if not found then raise insufficient_privilege; end if;
 delete from finance.transaction_events where user_id=subject;
 delete from finance.transaction_entries where user_id=subject;
 delete from finance.transactions where user_id=subject;
 delete from finance.category_events where user_id=subject;
 delete from finance.account_events where user_id=subject;
 delete from finance.categories where user_id=subject;
 delete from finance.accounts where user_id=subject;
 delete from finance.profiles where user_id=subject;
end $$;
revoke finzi_deletion_worker from postgres;
