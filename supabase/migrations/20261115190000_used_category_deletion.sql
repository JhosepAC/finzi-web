-- Remove used categories without detaching immutable financial history.
alter table finance.categories add column deleted_at timestamptz;
alter table finance.categories add constraint categories_deleted_archived check(deleted_at is null or status='archived');
create or replace function finance.guard_category() returns trigger language plpgsql security invoker set search_path='' as $$
declare parent finance.categories%rowtype;
begin
  if tg_op='UPDATE' and old.deleted_at is not null then raise no_data_found; end if;
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

create or replace function api.read_categories() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if finance.request_user_id() is null then raise insufficient_privilege; end if;
  return jsonb_build_object('initialized',exists(select 1 from finance.profiles where user_id=finance.request_user_id() and categories_initialized_at is not null),
    'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'parent_id',c.parent_id,'kind',c.kind,'name',c.name,
    'description',c.description,'color',c.color,'icon',c.icon,'image_path',c.image_path,'status',c.status,'version',c.version,
    'movement_count',(select count(*) from finance.transactions t where t.user_id=c.user_id and t.category_id=c.id),
    'effective_archived',c.status='archived' or coalesce(p.status='archived',false)) order by c.created_at,c.id),'[]'::jsonb)
    from finance.categories c left join finance.categories p on p.user_id=c.user_id and p.id=c.parent_id
    where c.user_id=finance.request_user_id() and c.deleted_at is null));
end $$;


create or replace function api.delete_category(p_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing finance.categories%rowtype; owned uuid;
begin
 owned:=finance.request_user_id(); if owned is null then raise insufficient_privilege; end if;
 perform 1 from finance.profiles where user_id=owned and onboarding_completed_at is not null for update;
 if not found then raise insufficient_privilege; end if;
 if p_id is null or p_expected_version is null or p_expected_version<1 then raise check_violation; end if;
 select * into existing from finance.categories where user_id=owned and id=p_id for update;
 if not found then raise no_data_found; end if;
 if existing.deleted_at is not null then return api.read_categories(); end if;
 if existing.version<>p_expected_version then raise serialization_failure; end if;
 if exists(select 1 from finance.categories where user_id=owned and parent_id=p_id and deleted_at is null) then raise dependent_objects_still_exist; end if;
 if exists(select 1 from finance.transactions where user_id=owned and category_id=p_id)
   or exists(select 1 from finance.categories where user_id=owned and parent_id=p_id) then
   update finance.categories set status='archived',deleted_at=clock_timestamp(),image_path=null,version=version+1,updated_at=now() where user_id=owned and id=p_id;
   insert into finance.category_events(user_id,category_id,action,version) values(owned,p_id,'archived',existing.version+1);
 else
   delete from finance.categories where user_id=owned and id=p_id;
 end if;
 return api.read_categories();
end $$;
