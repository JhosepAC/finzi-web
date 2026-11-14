-- Deferred constraints run at the caller's COMMIT, after a SECURITY DEFINER RPC
-- has restored its invoker. Use the same restricted executor, still subject to
-- forced RLS and the verified request claims, rather than granting table access.
grant app_executor to postgres;
grant create on schema finance to app_executor;
alter function finance.check_transaction_entries() security definer;
alter function finance.check_transaction_entries() owner to app_executor;
revoke create on schema finance from app_executor;
revoke all on function finance.check_transaction_entries() from public,anon,authenticated;
revoke app_executor from postgres;
