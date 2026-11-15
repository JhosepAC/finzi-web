-- Preserve private category metadata and debt history after integration.
grant app_executor to postgres;
create or replace function api.export_personal_data(p_proof text,p_format text,p_currency text default 'PEN',p_kind text default null,p_account_id uuid default null,p_category_id uuid default null,
 p_from date default null,p_to date default null,p_query text default '',p_status text default 'all') returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid:=finance.request_user_id(); profile finance.profiles%rowtype; captured timestamptz; result jsonb; account_rows jsonb;
begin
 if owned is null then raise insufficient_privilege; end if;
 select * into profile from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
 if not found then raise insufficient_privilege; end if;
 captured:=clock_timestamp();
 if p_format is null or p_format not in ('json','csv') or p_currency is null or p_currency not in ('PEN','USD')
  or (p_kind is not null and p_kind not in ('income','expense','transfer')) or p_status is null or p_status not in ('all','posted','void','replaced')
  or p_query is null or length(p_query)>200 or (p_from is not null and (not isfinite(p_from) or p_from<date '1900-01-01'))
  or (p_to is not null and not isfinite(p_to)) or (p_from is not null and p_to is not null and p_from>p_to) then raise check_violation; end if;
 if p_format='json' and (p_kind is not null or p_account_id is not null or p_category_id is not null or p_from is not null or p_to is not null or p_query<>'' or p_status<>'all') then raise check_violation; end if;
 if (p_account_id is not null and not exists(select 1 from finance.accounts where user_id=owned and id=p_account_id and currency_code=p_currency))
  or (p_category_id is not null and not exists(select 1 from finance.categories where user_id=owned and id=p_category_id)) then raise no_data_found; end if;
 delete from finance.export_events where user_id=owned and created_at<captured-interval '1 hour';
 if (select count(*) from finance.export_events where user_id=owned)>=3 then raise program_limit_exceeded; end if;
 if not api.consume_reauth_proof(p_proof,'export_data') then raise insufficient_privilege; end if;
 insert into finance.export_events(user_id,created_at) values(owned,captured);
 if p_format='csv' then
  return jsonb_build_object('format_version','finzi.movements/v1','exported_at',captured,'timezone',profile.timezone,'currency',p_currency,
   'movements',(select coalesce(jsonb_agg(to_jsonb(m)-'user_id' order by m.occurred_at desc,m.id desc),'[]'::jsonb) from finance.movement_details m
    where m.user_id=owned and m.currency_code=p_currency and (p_kind is null or m.kind=p_kind)
    and (p_account_id is null or m.account_id=p_account_id or m.destination_id=p_account_id)
    and (p_category_id is null or m.category_id=p_category_id or exists(select 1 from finance.categories c where c.user_id=owned and c.id=m.category_id and c.parent_id=p_category_id))
    and (p_status='all' or (p_status='replaced' and m.replaced_by_id is not null) or (p_status<>'replaced' and m.status=p_status))
    and (p_from is null or m.occurred_at>=(p_from::timestamp at time zone profile.timezone)) and (p_to is null or m.occurred_at<((p_to+1)::timestamp at time zone profile.timezone))
    and (p_query='' or strpos(lower(m.description||' '||m.note),lower(p_query))>0)));
 end if;
 account_rows:=api.read_accounts();
 result:=jsonb_build_object('format_version','finzi.personal-data/v1','exported_at',captured,'timezone',profile.timezone,
  'profile',jsonb_build_object('display_name',profile.display_name,'locale',profile.locale,'preferred_currency',profile.preferred_currency,'timezone',profile.timezone,'onboarding_completed_at',profile.onboarding_completed_at,'version',profile.version,'created_at',profile.created_at,'updated_at',profile.updated_at),
  'accounts',(select coalesce(jsonb_agg(v.value||jsonb_build_object('created_at',a.created_at,'updated_at',a.updated_at) order by a.created_at,a.id),'[]'::jsonb) from jsonb_array_elements(account_rows) v(value) join finance.accounts a on a.id::text=v.value->>'id' and a.user_id=owned),
  'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'parent_id',parent_id,'kind',kind,'name',name,'description',description,'color',color,'icon',icon,'image_path',image_path,'status',status,'version',version,'created_at',created_at,'updated_at',updated_at) order by id),'[]'::jsonb) from finance.categories where user_id=owned),
  'movements',(select coalesce(jsonb_agg(to_jsonb(m)-'user_id' order by m.occurred_at desc,m.id desc),'[]'::jsonb) from finance.movement_details m where m.user_id=owned),
  'entries',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'transaction_id',transaction_id,'account_id',account_id,'signed_minor',(signed_amount*100)::numeric(20,0)::text,'created_at',created_at) order by id),'[]'::jsonb) from finance.transaction_entries where user_id=owned),
  'transaction_events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'transaction_id',transaction_id,'action',action,'version',version,'recorded_at',recorded_at) order by recorded_at,id),'[]'::jsonb) from finance.transaction_events where user_id=owned),
  'account_events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'account_id',account_id,'action',action,'version',version,'recorded_at',recorded_at) order by recorded_at,id),'[]'::jsonb) from finance.account_events where user_id=owned),
  'category_events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'category_id',category_id,'action',action,'version',version,'recorded_at',recorded_at) order by recorded_at,id),'[]'::jsonb) from finance.category_events where user_id=owned),
  'profile_events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'action',action,'previous_timezone',previous_timezone,'new_timezone',new_timezone,'previous_currency',previous_currency,'new_currency',new_currency,'recorded_at',recorded_at) order by version),'[]'::jsonb) from finance.profile_events where user_id=owned));
 result:=result||jsonb_build_object('debts',(api.read_debts())->'debts','debt_events',(select coalesce(jsonb_agg(jsonb_build_object('debt_id',debt_id,'action',action,'recorded_at',recorded_at) order by recorded_at,id),'[]'::jsonb) from finance.debt_events where user_id=owned));
 return result;
end $$;


revoke app_executor from postgres;
