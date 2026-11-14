-- A-09: metadata audit and short-lived, single-use password reauthentication proof.
create table finance.profile_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references finance.profiles(user_id) on delete cascade,
 version integer not null,action text not null check(action in ('configured','updated')),
 previous_timezone text,new_timezone text,previous_currency text,new_currency text,recorded_at timestamptz not null default now(),unique(user_id,version)
);
alter table finance.profile_events enable row level security;
alter table finance.profile_events force row level security;
revoke all on finance.profile_events from public,anon,authenticated;
grant select,insert on finance.profile_events to app_executor;
create policy profile_events_read on finance.profile_events for select to app_executor using(user_id=(select finance.request_user_id()));
create policy profile_events_insert on finance.profile_events for insert to app_executor with check(user_id=(select finance.request_user_id()));
create function finance.audit_profile_preferences() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.display_name,new.preferred_currency,new.timezone) is distinct from (old.display_name,old.preferred_currency,old.timezone) then
  insert into finance.profile_events(user_id,version,action,previous_timezone,new_timezone,previous_currency,new_currency)
   values(new.user_id,new.version,case when old.onboarding_completed_at is null and new.onboarding_completed_at is not null then 'configured' else 'updated' end,old.timezone,new.timezone,old.preferred_currency,new.preferred_currency);
 end if;
 return new;
end $$;
create trigger profile_preferences_audit after update on finance.profiles for each row execute function finance.audit_profile_preferences();
revoke all on function finance.audit_profile_preferences() from public,anon,authenticated;

create table finance.reauth_proofs (
 user_id uuid not null references finance.profiles(user_id) on delete cascade,session_id uuid not null,purpose text not null check(purpose='change_password'),
 token_hash bytea not null unique,created_at timestamptz not null,expires_at timestamptz not null,consumed_at timestamptz,
 primary key(user_id,session_id,purpose),check(octet_length(token_hash)=32),check(expires_at>created_at and expires_at<=created_at+interval '5 minutes')
);
alter table finance.reauth_proofs enable row level security;
alter table finance.reauth_proofs force row level security;
revoke all on finance.reauth_proofs from public,anon,authenticated;
grant select,insert,update,delete on finance.reauth_proofs to app_executor;
create policy proof_read on finance.reauth_proofs for select to app_executor using(user_id=(select finance.request_user_id()));
create policy proof_insert on finance.reauth_proofs for insert to app_executor with check(user_id=(select finance.request_user_id()));
create policy proof_update on finance.reauth_proofs for update to app_executor using(user_id=(select finance.request_user_id())) with check(user_id=(select finance.request_user_id()));
create policy proof_delete on finance.reauth_proofs for delete to app_executor using(user_id=(select finance.request_user_id()));

-- PostgREST validates the JWT and installs these request claims; iat is never evidence of a fresh password.
create function api.issue_reauth_proof(p_purpose text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id(); claims jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
 sid uuid; token text; issued timestamptz:=clock_timestamp();
begin
 if owned is null or p_purpose is distinct from 'change_password' or claims->>'session_id' is null
   or (claims->>'session_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(claims->'amr') is distinct from 'array' then raise insufficient_privilege; end if;
 if not exists(select 1 from jsonb_array_elements(claims->'amr') a where a->>'method'='password'
   and case when (a->>'timestamp') ~ '^[0-9]{1,12}$' then (a->>'timestamp')::numeric<=extract(epoch from issued)
     and extract(epoch from issued)-(a->>'timestamp')::numeric<=300 else false end) then raise insufficient_privilege; end if;
 sid:=(claims->>'session_id')::uuid;
 perform 1 from finance.profiles where user_id=owned for update; if not found then raise insufficient_privilege; end if;
 delete from finance.reauth_proofs where user_id=owned and (expires_at<=issued or consumed_at is not null);
 if not exists(select 1 from finance.reauth_proofs where user_id=owned and session_id=sid and purpose=p_purpose)
    and (select count(*) from finance.reauth_proofs where user_id=owned)>=20 then raise program_limit_exceeded; end if;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into finance.reauth_proofs(user_id,session_id,purpose,token_hash,created_at,expires_at,consumed_at)
  values(owned,sid,p_purpose,sha256(convert_to(token,'UTF8')),issued,issued+interval '5 minutes',null)
  on conflict(user_id,session_id,purpose) do update set token_hash=excluded.token_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,consumed_at=null;
 return jsonb_build_object('token',token,'expires_at',issued+interval '5 minutes');
end $$;
create function api.consume_reauth_proof(p_token text,p_purpose text) returns boolean language plpgsql security definer set search_path='' as $$
declare claims jsonb:=nullif(current_setting('request.jwt.claims',true),'')::jsonb; consumed boolean;
begin
 if finance.request_user_id() is null then raise insufficient_privilege; end if;
 if p_purpose is distinct from 'change_password' or p_token is null or p_token !~ '^[a-f0-9]{64}$' then return false; end if;
 update finance.reauth_proofs set consumed_at=clock_timestamp() where user_id=finance.request_user_id() and session_id::text=claims->>'session_id'
  and purpose=p_purpose and token_hash=sha256(convert_to(p_token,'UTF8')) and consumed_at is null and expires_at>clock_timestamp() returning true into consumed;
 return coalesce(consumed,false);
end $$;
create function api.read_reauth_proof(p_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('expires_at',expires_at) from finance.reauth_proofs where user_id=finance.request_user_id()
  and session_id::text=(nullif(current_setting('request.jwt.claims',true),'')::jsonb)->>'session_id'
  and purpose='change_password' and p_token ~ '^[a-f0-9]{64}$' and token_hash=sha256(convert_to(p_token,'UTF8')) and consumed_at is null and expires_at>statement_timestamp();
$$;
create function api.read_profile_events() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if finance.request_user_id() is null then raise insufficient_privilege; end if;
 return(select coalesce(jsonb_agg(to_jsonb(e)-array['user_id','id'] order by e.version desc),'[]'::jsonb) from
  (select * from finance.profile_events where user_id=finance.request_user_id() order by version desc limit 10) e);
end $$;
grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.issue_reauth_proof(text) owner to app_executor;
alter function api.consume_reauth_proof(text,text) owner to app_executor;
alter function api.read_reauth_proof(text) owner to app_executor;
alter function api.read_profile_events() owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.issue_reauth_proof(text),api.consume_reauth_proof(text,text),api.read_reauth_proof(text),api.read_profile_events() from public,anon,authenticated;
grant execute on function api.issue_reauth_proof(text),api.consume_reauth_proof(text,text),api.read_reauth_proof(text),api.read_profile_events() to authenticated;
revoke app_executor from postgres;
