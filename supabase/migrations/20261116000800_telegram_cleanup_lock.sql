-- Fix startup cleanup without widening metadata or financial privileges.
begin;
create or replace function telegram_private.cleanup_queries(p_limit integer default 500) returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if p_limit is null or p_limit not between 1 and 500 then raise check_violation;end if;
 -- Serialize sweepers without SELECT FOR UPDATE (which would require UPDATE grants).
 if not pg_try_advisory_xact_lock(hashtextextended('finzi-telegram-query-cleanup',0)) then return 0;end if;
 with stale as(select id from telegram_private.query_sessions where expires_at<=clock_timestamp() order by expires_at limit p_limit)
 delete from telegram_private.query_sessions q using stale where q.id=stale.id;
 get diagnostics affected=row_count;return affected;
end $$;
commit;
