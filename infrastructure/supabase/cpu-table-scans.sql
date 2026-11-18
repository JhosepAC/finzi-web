select schemaname,relname,n_live_tup,seq_scan,seq_tup_read,idx_scan,idx_tup_fetch from pg_stat_user_tables
where schemaname in ('finance','ops','telegram_private') order by seq_tup_read desc limit 12;
