with ranked as (
 select queryid::text,userid::regrole::text as role,calls,total_exec_time,mean_exec_time,max_exec_time,rows,shared_blks_hit,shared_blks_read,
 case when query ilike '%pg_stat_statements%' then 'diagnostic/statements'
 when query ilike '%pg_stat_activity%' then 'diagnostic/activity'
 when query ilike '%pg_namespace%' or query ilike '%pg_roles%' then 'catalog/preflight'
 when query ilike '%telegram_issue_link%' then 'api.telegram_issue_link'
 when query ilike '%telegram_activate_link%' then 'api.telegram_activate_link'
 when query ilike '%configure_profile%' then 'api.configure_profile'
 when query ilike '%ensure_profile%' then 'api.ensure_profile'
 when query ilike '%read_profile%' then 'api.read_profile'
 when query ilike '%create_account%' then 'api.create_account'
 when query ilike '%read_accounts%' then 'api.read_accounts'
 when query ilike '%initialize_categories%' then 'api.initialize_categories'
 when query ilike '%replace_movement%' then 'api.replace_movement'
 when query ilike '%post_movement%' then 'api.post_movement'
 when query ilike '%read_movements%' then 'api.read_movements'
 when query ilike '%read_overview%' then 'api.read_overview'
 when query ilike '%read_statistics%' then 'api.read_statistics'
 when query ilike '%debt_command%' then 'api.debt_command'
 when query ilike '%fixed_expense_command%' then 'api.fixed_expense_command'
 when query ilike '%enqueue_update%' then 'telegram.enqueue_update'
 when query ilike '%claim_update%' then 'telegram.claim_update'
 when query ilike '%dispatch_update%' then 'telegram.dispatch_update'
 when query ilike '%update_credentials%' then 'telegram.update_credentials'
 when query ilike '%finish_update%' then 'telegram.finish_update'
 when query ilike '%transport_guard%' then 'telegram.transport_guard'
 when query ilike '%select version()%' then 'connection/version'
 when query ilike '%set_config%' then 'session/config'
 when query ~* '^\s*(BEGIN|COMMIT|ROLLBACK|END)' then 'transaction/control'
 when query ilike '%pg_catalog%' then 'catalog/other'
 else 'other/'||coalesce(upper(substring(query from '^\s*([A-Za-z]+)')),'unknown') end as operation
 from extensions.pg_stat_statements where dbid=(select oid from pg_database where datname=current_database())
)
select clock_timestamp() as observed_at,
 (select stats_reset from extensions.pg_stat_statements_info) as stats_reset,
 (select jsonb_agg(to_jsonb(x)) from (select * from ranked order by total_exec_time desc limit 15) x) as highest_total_time,
 (select jsonb_agg(to_jsonb(x)) from (select * from ranked order by calls desc limit 15) x) as most_calls,
 (select jsonb_agg(to_jsonb(x)) from (select role,sum(calls) as calls,round(sum(total_exec_time)::numeric,2) as total_exec_ms from ranked group by role order by sum(total_exec_time) desc) x) as roles,
 (select jsonb_agg(to_jsonb(x)) from (select operation,sum(calls) as calls,round(sum(total_exec_time)::numeric,2) as total_exec_ms from ranked group by operation order by sum(total_exec_time) desc limit 20) x) as operations;
