-- Immutable account identity/currency/date, even inside future RPCs.
create function finance.guard_account_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.opening_at > clock_timestamp() then raise check_violation; end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.user_id <> old.user_id or new.currency_code <> old.currency_code
      or new.type <> old.type or new.opening_at <> old.opening_at or new.created_at <> old.created_at
      or new.version <> old.version + 1 then raise check_violation; end if;
  end if;
  return new;
end $$;
revoke all on function finance.guard_account_identity() from public, anon, authenticated;
create trigger account_identity_guard before insert or update on finance.accounts
for each row execute function finance.guard_account_identity();
