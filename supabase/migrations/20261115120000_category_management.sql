-- Category management: definitive deletion of unused categories, a wider closed
-- icon catalog and private per-user images. No financial posting changes.
grant app_executor,finzi_deletion_worker to postgres;
grant create on schema api to app_executor;
alter table finance.categories add column image_path text;
alter table finance.categories drop constraint categories_icon_check;
alter table finance.categories add constraint categories_icon_check check (icon in (
  'tag','home','sofa','bed','lamp','utensils','coffee','shopping-basket','cart','shirt','washing-machine','wrench','plug',
  'car','bus','train-front','bike','plane','fuel','parking-circle','ship',
  'heart','heart-pulse','stethoscope','pill','dumbbell','baby','paw-print',
  'book','book-open','graduation-cap','pencil','laptop','globe',
  'briefcase','wallet','credit-card','banknote','piggy-bank','receipt','calculator','chart-line','hand-coins','building-2',
  'gift','gamepad-2','music','film','ticket','palette','camera','party-popper','tent','map-pin',
  'star','sparkles','users','smartphone','wifi','shield-check','leaf','sun','repeat','folder'
));
alter table finance.categories add constraint categories_image_path_check check (
  image_path is null or (length(image_path) between 40 and 200
    and image_path ~ ('^'||user_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'))
);
grant delete on finance.categories to app_executor;
create policy categories_delete on finance.categories for delete to app_executor
  using (user_id=(select finance.request_user_id()));

create or replace function api.read_categories() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  return jsonb_build_object('initialized',exists(select 1 from finance.profiles where user_id=finance.request_user_id() and categories_initialized_at is not null),
    'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'parent_id',c.parent_id,'kind',c.kind,'name',c.name,
    'description',c.description,'color',c.color,'icon',c.icon,'image_path',c.image_path,'status',c.status,'version',c.version,
    'movement_count',(select count(*) from finance.transactions t where t.user_id=c.user_id and t.category_id=c.id),
    'effective_archived',c.status='archived' or coalesce(p.status='archived',false)) order by c.created_at,c.id),'[]'::jsonb)
    from finance.categories c left join finance.categories p on p.user_id=c.user_id and p.id=c.parent_id
    where c.user_id=finance.request_user_id()));
end $$;

drop function api.create_category(uuid,uuid,text,text,text,text,text);
drop function api.update_category(uuid,text,text,text,text,boolean,integer);

create function api.create_category(p_request_id uuid,p_parent_id uuid,p_kind text,p_name text,p_description text,p_color text,p_icon text,p_image_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing finance.categories%rowtype; owned uuid; category_id uuid;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_request_id is null or p_name is null or length(btrim(p_name)) not between 1 and 80
    or p_description is null or length(btrim(p_description))>300 or p_kind is null or p_kind not in ('income','expense')
    or p_color is null or p_color not in ('blue','green','amber','purple','rose','slate')
    or p_icon is null or p_icon not in (
      'tag','home','sofa','bed','lamp','utensils','coffee','shopping-basket','cart','shirt','washing-machine','wrench','plug',
      'car','bus','train-front','bike','plane','fuel','parking-circle','ship',
      'heart','heart-pulse','stethoscope','pill','dumbbell','baby','paw-print',
      'book','book-open','graduation-cap','pencil','laptop','globe',
      'briefcase','wallet','credit-card','banknote','piggy-bank','receipt','calculator','chart-line','hand-coins','building-2',
      'gift','gamepad-2','music','film','ticket','palette','camera','party-popper','tent','map-pin',
      'star','sparkles','users','smartphone','wifi','shield-check','leaf','sun','repeat','folder')
    or (p_image_path is not null and p_image_path !~ ('^'||owned::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')) then raise check_violation; end if;
  select * into existing from finance.categories where user_id=owned and create_request_id=p_request_id;
  if found then
    if existing.parent_id is not distinct from p_parent_id and existing.kind=p_kind and existing.name=btrim(p_name)
      and existing.description=btrim(p_description) and existing.color=p_color and existing.icon=p_icon
      and existing.image_path is not distinct from p_image_path then return api.read_categories(); end if;
    raise serialization_failure;
  end if;
  if (select count(*) from finance.categories where user_id=owned)>=200 then raise program_limit_exceeded; end if;
  insert into finance.categories(user_id,create_request_id,parent_id,kind,name,description,color,icon,image_path)
    values(owned,p_request_id,p_parent_id,p_kind,btrim(p_name),btrim(p_description),p_color,p_icon,p_image_path) returning id into category_id;
  insert into finance.category_events(user_id,category_id,action,version) values(owned,category_id,'created',1);
  return api.read_categories();
end $$;

create function api.update_category(p_id uuid,p_name text,p_description text,p_color text,p_icon text,p_image_path text,p_archived boolean,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing finance.categories%rowtype; owned uuid; next_status text;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  -- Serializes parent archive/restore with child creation/restore for this owner.
  -- Before ledger writes: coordinate this lock with category/ancestor eligibility checks.
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 or p_description is null or length(btrim(p_description))>300
    or p_color is null or p_color not in ('blue','green','amber','purple','rose','slate')
    or p_icon is null or p_icon not in (
      'tag','home','sofa','bed','lamp','utensils','coffee','shopping-basket','cart','shirt','washing-machine','wrench','plug',
      'car','bus','train-front','bike','plane','fuel','parking-circle','ship',
      'heart','heart-pulse','stethoscope','pill','dumbbell','baby','paw-print',
      'book','book-open','graduation-cap','pencil','laptop','globe',
      'briefcase','wallet','credit-card','banknote','piggy-bank','receipt','calculator','chart-line','hand-coins','building-2',
      'gift','gamepad-2','music','film','ticket','palette','camera','party-popper','tent','map-pin',
      'star','sparkles','users','smartphone','wifi','shield-check','leaf','sun','repeat','folder')
    or (p_image_path is not null and p_image_path !~ ('^'||owned::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'))
    or p_archived is null or p_expected_version is null or p_expected_version<1 then raise check_violation; end if;
  select * into existing from finance.categories where user_id=owned and id=p_id for update;
  if not found then raise no_data_found; end if;
  next_status:=case when p_archived then 'archived' else 'active' end;
  if existing.name=btrim(p_name) and existing.description=btrim(p_description) and existing.color=p_color
    and existing.icon=p_icon and existing.image_path is not distinct from p_image_path and existing.status=next_status then return api.read_categories(); end if;
  if existing.version<>p_expected_version then raise serialization_failure; end if;
  update finance.categories set name=btrim(p_name),description=btrim(p_description),color=p_color,icon=p_icon,image_path=p_image_path,
    status=next_status,version=version+1,updated_at=now() where user_id=owned and id=p_id;
  insert into finance.category_events(user_id,category_id,action,version) values(owned,p_id,
    case when existing.status<>next_status then case when p_archived then 'archived' else 'restored' end else 'updated' end,existing.version+1);
  return api.read_categories();
end $$;

-- Re-declared with the new create_category signature: initial templates never carry images.
create or replace function api.initialize_categories() returns jsonb language plpgsql security definer set search_path='' as $$
declare owned uuid; initialized timestamptz; template record;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  select categories_initialized_at into initialized from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if initialized is not null then return api.read_categories(); end if;
  for template in select * from (values
    ('expense','Alimentación','amber','utensils'),('expense','Vivienda','blue','home'),
    ('expense','Transporte','purple','car'),('expense','Salud','rose','heart'),
    ('expense','Educación','slate','book'),('expense','Otros gastos','slate','tag'),
    ('income','Salario','green','briefcase'),('income','Freelance','blue','briefcase'),
    ('income','Bonificaciones','purple','gift'),('income','Otros ingresos','slate','wallet')
  ) as t(kind,name,color,icon) loop
    if not exists(select 1 from finance.categories where user_id=owned and parent_id is null and kind=template.kind and lower(name)=lower(template.name)) then
      perform api.create_category(pg_catalog.gen_random_uuid(),null,template.kind,template.name,'',template.color,template.icon,null);
    end if;
  end loop;
  update finance.profiles set categories_initialized_at=now() where user_id=owned;
  return api.read_categories();
end $$;

create function api.delete_category(p_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing finance.categories%rowtype; owned uuid;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_id is null or p_expected_version is null or p_expected_version<1 then raise check_violation; end if;
  select * into existing from finance.categories where user_id=owned and id=p_id for update;
  if not found then raise no_data_found; end if;
  if existing.version<>p_expected_version then raise serialization_failure; end if;
  -- Unused only: children and any movement (posted or void) keep the row and its history.
  if exists(select 1 from finance.categories where user_id=owned and parent_id=p_id) then raise dependent_objects_still_exist; end if;
  if exists(select 1 from finance.transactions where user_id=owned and category_id=p_id) then raise foreign_key_violation; end if;
  delete from finance.categories where user_id=owned and id=p_id;
  return api.read_categories();
end $$;

-- Private bucket. The API normalizes every upload to WebP before writing.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('category-images','category-images',false,1048576,array['image/webp'])
  on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists category_images_select on storage.objects;
drop policy if exists category_images_insert on storage.objects;
drop policy if exists category_images_update on storage.objects;
drop policy if exists category_images_delete on storage.objects;
create policy category_images_select on storage.objects for select to authenticated
  using (bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy category_images_insert on storage.objects for insert to authenticated
  with check (bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy category_images_update on storage.objects for update to authenticated
  using (bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid())::text)
  with check (bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy category_images_delete on storage.objects for delete to authenticated
  using (bucket_id='category-images' and (storage.foldername(name))[1]=(select auth.uid())::text);

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
 return result;
end $$;

create or replace function ops.deletion_step(p_id uuid,p_lease text,p_action text,p_digest text default null) returns void language plpgsql security definer set search_path='' as $$
declare subject uuid; receipt ops.deletion_receipts%rowtype;
begin
 select * into receipt from ops.deletion_receipts where id=p_id and lease_hash=sha256(convert_to(p_lease,'UTF8')) and lease_until>clock_timestamp() and stage<>'completed' for update;
 if not found then raise insufficient_privilege; end if;
 select user_id into subject from ops.deletion_subjects where receipt_id=p_id; if not found then raise check_violation; end if;
 if p_action='manifest' then
  if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise check_violation; end if;
  update ops.deletion_receipts set manifest_digest=p_digest,updated_at=clock_timestamp() where id=p_id;
 elsif p_action='purge' then
  if receipt.manifest_digest is null then raise check_violation; end if;
  -- This function belongs to postgres and is worker-only: no user-controlled subject argument.
  delete from auth.sessions where user_id=subject;
  perform ops.purge_profile(p_id,p_lease);
  update ops.deletion_receipts set stage='identity_pending',updated_at=clock_timestamp() where id=p_id;
 elsif p_action='complete' then
  if receipt.manifest_digest is null or receipt.stage<>'identity_pending' or exists(select 1 from auth.users where id=subject) then raise check_violation; end if;
  update ops.deletion_receipts set stage='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp(),lease_hash=null,lease_until=null,error_code=null,next_retry_at=null where id=p_id;
  delete from ops.deletion_subjects where receipt_id=p_id;
  delete from ops.deletion_blocks where user_id=subject;
 elsif p_action in ('manifest_unavailable','storage_unavailable','database_unavailable','auth_unavailable') then
  update ops.deletion_receipts set error_code=p_action,next_retry_at=clock_timestamp()+interval '15 seconds',lease_hash=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
 else raise check_violation;
 end if;
end $$;

-- Compatibility overloads for callers written before category images existed.
create or replace function api.create_category(p_request_id uuid,p_parent_id uuid,p_kind text,p_name text,p_description text,p_color text,p_icon text)
returns jsonb language sql security definer set search_path='' as $$
  select api.create_category(p_request_id,p_parent_id,p_kind,p_name,p_description,p_color,p_icon,null);
$$;

create or replace function api.update_category(p_id uuid,p_name text,p_description text,p_color text,p_icon text,p_archived boolean,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_image text;
begin
  select image_path into current_image from finance.categories where user_id=finance.request_user_id() and id=p_id;
  return api.update_category(p_id,p_name,p_description,p_color,p_icon,current_image,p_archived,p_expected_version);
end $$;

alter function api.create_category(uuid,uuid,text,text,text,text,text,text) owner to app_executor;
alter function api.create_category(uuid,uuid,text,text,text,text,text) owner to app_executor;
alter function api.update_category(uuid,text,text,text,text,boolean,integer) owner to app_executor;
alter function api.update_category(uuid,text,text,text,text,text,boolean,integer) owner to app_executor;
alter function api.delete_category(uuid,integer) owner to app_executor;
revoke all on function api.read_categories(),api.create_category(uuid,uuid,text,text,text,text,text,text),
  api.create_category(uuid,uuid,text,text,text,text,text),
  api.update_category(uuid,text,text,text,text,text,boolean,integer),
  api.update_category(uuid,text,text,text,text,boolean,integer),api.delete_category(uuid,integer),api.initialize_categories()
  from public,anon,authenticated;
grant execute on function api.read_categories(),api.create_category(uuid,uuid,text,text,text,text,text,text),
  api.create_category(uuid,uuid,text,text,text,text,text),
  api.update_category(uuid,text,text,text,text,text,boolean,integer),
  api.update_category(uuid,text,text,text,text,boolean,integer),api.delete_category(uuid,integer),api.initialize_categories()
  to authenticated;
-- The compatibility overloads run as app_executor and forward to the image-aware versions.
grant execute on function api.create_category(uuid,uuid,text,text,text,text,text,text),
  api.update_category(uuid,text,text,text,text,text,boolean,integer)
  to app_executor;
revoke create on schema api from app_executor;
revoke app_executor,finzi_deletion_worker from postgres;
