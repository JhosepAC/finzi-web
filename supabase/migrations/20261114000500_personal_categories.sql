-- A-05: owned categories. No transaction ledger or financial postings.
alter table finance.profiles add column categories_initialized_at timestamptz;
create table finance.categories (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references finance.profiles(user_id) on delete cascade,
  create_request_id uuid not null,
  parent_id uuid,
  kind text not null check (kind in ('income','expense')),
  name text not null check (length(name) between 1 and 80 and name = btrim(name)),
  description text not null default '' check (length(description) <= 300),
  color text not null check (color in ('blue','green','amber','purple','rose','slate')),
  icon text not null check (icon in ('tag','home','cart','car','heart','briefcase','book','gift','utensils','wallet')),
  status text not null default 'active' check (status in ('active','archived')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,id), unique(user_id,create_request_id),
  foreign key (user_id,parent_id) references finance.categories(user_id,id),
  check (parent_id is distinct from id)
);
create unique index categories_sibling_name on finance.categories
  (user_id,kind,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name));
create index categories_parent on finance.categories(user_id,parent_id);
create table finance.category_events (
  id uuid primary key default pg_catalog.gen_random_uuid(), user_id uuid not null,
  category_id uuid not null, action text not null check (action in ('created','updated','archived','restored')),
  version integer not null, recorded_at timestamptz not null default now(),
  unique(user_id,category_id,version),
  foreign key (user_id,category_id) references finance.categories(user_id,id) on delete cascade
);
alter table finance.categories enable row level security;
alter table finance.categories force row level security;
alter table finance.category_events enable row level security;
alter table finance.category_events force row level security;
revoke all on finance.categories,finance.category_events from public,anon,authenticated;
grant select,insert,update on finance.categories to app_executor;
grant select,insert on finance.category_events to app_executor;
create policy categories_read on finance.categories for select to app_executor using (user_id=(select finance.request_user_id()));
create policy categories_insert on finance.categories for insert to app_executor with check (user_id=(select finance.request_user_id()));
create policy categories_update on finance.categories for update to app_executor using (user_id=(select finance.request_user_id())) with check (user_id=(select finance.request_user_id()));
create policy category_events_read on finance.category_events for select to app_executor using (user_id=(select finance.request_user_id()));
create policy category_events_insert on finance.category_events for insert to app_executor with check (user_id=(select finance.request_user_id()));

create function finance.guard_category() returns trigger language plpgsql security invoker set search_path='' as $$
declare parent finance.categories%rowtype;
begin
  if tg_op='UPDATE' and (new.id<>old.id or new.user_id<>old.user_id or new.create_request_id<>old.create_request_id
    or new.parent_id is distinct from old.parent_id or new.kind<>old.kind or new.created_at<>old.created_at
    or new.version<>old.version+1) then raise check_violation; end if;
  if new.parent_id is not null then
    select * into parent from finance.categories where user_id=new.user_id and id=new.parent_id;
    if not found or parent.parent_id is not null or parent.kind<>new.kind then raise check_violation; end if;
    if parent.status='archived' then
      if tg_op='INSERT' then raise check_violation;
      elsif old.status='archived' and new.status='active' then raise check_violation; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function finance.guard_category() from public,anon,authenticated;
create trigger category_identity before insert or update on finance.categories for each row execute function finance.guard_category();

create function api.read_categories() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  return jsonb_build_object('initialized',exists(select 1 from finance.profiles where user_id=finance.request_user_id() and categories_initialized_at is not null),
    'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'parent_id',c.parent_id,'kind',c.kind,'name',c.name,
    'description',c.description,'color',c.color,'icon',c.icon,'status',c.status,'version',c.version,
    'effective_archived',c.status='archived' or coalesce(p.status='archived',false)) order by c.created_at,c.id),'[]'::jsonb)
    from finance.categories c left join finance.categories p on p.user_id=c.user_id and p.id=c.parent_id
    where c.user_id=finance.request_user_id()));
end $$;

create function api.create_category(p_request_id uuid,p_parent_id uuid,p_kind text,p_name text,p_description text,p_color text,p_icon text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing finance.categories%rowtype; owned uuid; category_id uuid;
begin
  owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
  perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
  if not found then raise insufficient_privilege; end if;
  if p_request_id is null or p_name is null or length(btrim(p_name)) not between 1 and 80
    or p_description is null or length(btrim(p_description))>300 or p_kind is null or p_kind not in ('income','expense')
    or p_color is null or p_color not in ('blue','green','amber','purple','rose','slate')
    or p_icon is null or p_icon not in ('tag','home','cart','car','heart','briefcase','book','gift','utensils','wallet') then raise check_violation; end if;
  select * into existing from finance.categories where user_id=owned and create_request_id=p_request_id;
  if found then
    if existing.parent_id is not distinct from p_parent_id and existing.kind=p_kind and existing.name=btrim(p_name)
      and existing.description=btrim(p_description) and existing.color=p_color and existing.icon=p_icon then return api.read_categories(); end if;
    raise serialization_failure;
  end if;
  if (select count(*) from finance.categories where user_id=owned)>=200 then raise program_limit_exceeded; end if;
  insert into finance.categories(user_id,create_request_id,parent_id,kind,name,description,color,icon)
    values(owned,p_request_id,p_parent_id,p_kind,btrim(p_name),btrim(p_description),p_color,p_icon) returning id into category_id;
  insert into finance.category_events(user_id,category_id,action,version) values(owned,category_id,'created',1);
  return api.read_categories();
end $$;

create function api.update_category(p_id uuid,p_name text,p_description text,p_color text,p_icon text,p_archived boolean,p_expected_version integer)
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
    or p_icon is null or p_icon not in ('tag','home','cart','car','heart','briefcase','book','gift','utensils','wallet')
    or p_archived is null or p_expected_version is null or p_expected_version<1 then raise check_violation; end if;
  select * into existing from finance.categories where user_id=owned and id=p_id for update;
  if not found then raise no_data_found; end if;
  next_status:=case when p_archived then 'archived' else 'active' end;
  if existing.name=btrim(p_name) and existing.description=btrim(p_description) and existing.color=p_color
    and existing.icon=p_icon and existing.status=next_status then return api.read_categories(); end if;
  if existing.version<>p_expected_version then raise serialization_failure; end if;
  update finance.categories set name=btrim(p_name),description=btrim(p_description),color=p_color,icon=p_icon,status=next_status,
    version=version+1,updated_at=now() where user_id=owned and id=p_id;
  insert into finance.category_events(user_id,category_id,action,version) values(owned,p_id,
    case when existing.status<>next_status then case when p_archived then 'archived' else 'restored' end else 'updated' end,existing.version+1);
  return api.read_categories();
end $$;

create function api.initialize_categories() returns jsonb language plpgsql security definer set search_path='' as $$
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
      perform api.create_category(pg_catalog.gen_random_uuid(),null,template.kind,template.name,'',template.color,template.icon);
    end if;
  end loop;
  update finance.profiles set categories_initialized_at=now() where user_id=owned;
  return api.read_categories();
end $$;

grant app_executor to postgres;
grant create on schema api to app_executor;
alter function api.read_categories() owner to app_executor;
alter function api.create_category(uuid,uuid,text,text,text,text,text) owner to app_executor;
alter function api.update_category(uuid,text,text,text,text,boolean,integer) owner to app_executor;
alter function api.initialize_categories() owner to app_executor;
revoke create on schema api from app_executor;
revoke all on function api.read_categories(),api.create_category(uuid,uuid,text,text,text,text,text),api.update_category(uuid,text,text,text,text,boolean,integer),api.initialize_categories() from public,anon,authenticated;
grant execute on function api.read_categories(),api.create_category(uuid,uuid,text,text,text,text,text),api.update_category(uuid,text,text,text,text,boolean,integer),api.initialize_categories() to authenticated;
revoke app_executor from postgres;
