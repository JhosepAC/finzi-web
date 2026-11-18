begin;
grant app_executor to postgres;
set local role app_executor;
grant execute on function api.post_movement(uuid,text,uuid,uuid,text,text,text,timestamptz),api.replace_movement(uuid,uuid,integer,text,text,uuid,uuid,uuid,text,text,text,timestamptz) to authenticated;
reset role;
revoke app_executor from postgres;
commit;
