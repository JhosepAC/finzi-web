select clock_timestamp() as observed_at,pid,application_name,state,query_id,backend_start,xact_start,query_start,state_change,backend_xid,
 extract(epoch from clock_timestamp()-xact_start)::integer as xact_age,
 case when query ilike '%post_movement%' then 'api.post_movement'
 when query ilike '%replace_movement%' then 'api.replace_movement'
 when query ilike '%create_account%' then 'api.create_account'
 when query ilike '%configure_profile%' then 'api.configure_profile'
 when query ilike '%telegram_%' then 'telegram RPC'
 when query ilike '%set_config%' then 'session/config'
 else 'other' end as operation
 from pg_stat_activity where usename='authenticator' order by pid;
