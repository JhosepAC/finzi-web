select current_setting('pg_stat_statements.track') as track,current_setting('pg_stat_statements.track_utility') as utility;
select queryid::text,
 regexp_replace(query,$rx$'(?:''|[^'])*'$rx$,'[literal]','g') as normalized_setup
 from extensions.pg_stat_statements where queryid=5360251647081715348 and userid=(select oid from pg_roles where rolname='authenticated');
