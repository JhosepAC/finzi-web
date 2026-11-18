with setting as materialized (select pg_catalog.set_config('search_path','',true))
select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'hash',md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')),'acl',p.proacl::text) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('api','finance','ops','telegram_private')),
 'tenant_tables_without_force_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('finance','ops','telegram_private') and c.relkind='r' and c.relname<>'currencies' and (not c.relrowsecurity or not c.relforcerowsecurity)),
 'runtime_excess_privileges',(select count(*) from pg_roles where rolname in ('app_executor','finzi_deletion_worker','finzi_telegram_gateway','finzi_telegram_transport_executor') and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolinherit)),
 'valid_transactions',(select count(*) from finance.transactions),
 'ledger_entries',(select count(*) from finance.transaction_entries),
 'migrations',(select count(*) from supabase_migrations.schema_migrations),
 'transport_states',(select jsonb_agg(to_jsonb(x)) from(select state,error_code,count(*) as count from telegram_private.transport_events group by state,error_code)x)
) as assurance from setting;
