-- Migration: 051
-- Purpose: Authorize ordering schedules and special hours by permitted location.
-- Apply after migration 050. This file is not applied automatically.

begin;

insert into mediasis.business_permissions (permission_key, name, description, active, archived_at)
values ('ordering_app.schedules.manage.full', 'Administrar horarios',
  'Administrar horarios semanales, cierres y horarios especiales en las ubicaciones permitidas.', true, null)
on conflict (permission_key) do update set name=excluded.name, description=excluded.description,
  active=true, archived_at=null, updated_at=now();

insert into mediasis.business_role_permissions (business_role_id, permission_key)
select br.business_role_id, 'ordering_app.schedules.manage.full'
from mediasis.business_roles br
where br.business_id is not null and br.role_key='business_full_access'
  and br.active and br.archived_at is null
on conflict (business_role_id, permission_key) do update set revoked_at=null;

create or replace function mediasis.require_ordering_app_schedule_access(p_business_id uuid, p_actor_app_user_id uuid)
returns boolean language plpgsql stable security definer set search_path=''
as $$
begin
  if p_actor_app_user_id is null then return true; end if;
  if not mediasis.team_actor_has_permission(p_business_id,p_actor_app_user_id,'ordering_app.schedules.manage.full') then
    raise exception 'Not authorized';
  end if;
  return true;
end; $$;

create or replace function mediasis.get_business_ordering_app_schedules_permission_catalog(p_business_id uuid,p_actor_app_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_roles jsonb;
begin
  perform mediasis.team_require_permission(p_business_id,p_actor_app_user_id,'members.read');
  select coalesce(jsonb_object_agg(br.business_role_id::text,coalesce(keys.permission_keys,'[]'::jsonb)),'{}'::jsonb)
  into v_roles from mediasis.business_roles br
  left join lateral (
    select jsonb_agg(brp.permission_key) permission_keys from mediasis.business_role_permissions brp
    where brp.business_role_id=br.business_role_id and brp.permission_key='ordering_app.schedules.manage.full'
      and brp.revoked_at is null
  ) keys on true
  where br.business_id=p_business_id and br.active and br.archived_at is null;
  return jsonb_build_object('success',true,'permissions',jsonb_build_array(jsonb_build_object(
    'key','ordering_app.schedules.manage.full','name','Administrar horarios',
    'description','Administrar horarios semanales, cierres y horarios especiales.')),'role_permissions',v_roles);
end; $$;

create or replace function mediasis.schedule_actor_location_allowed(p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare v_membership mediasis.business_memberships%rowtype;
begin
  perform mediasis.require_ordering_app_schedule_access(p_business_id,p_actor_app_user_id);
  if not exists(select 1 from mediasis.business_location bl where bl.business_location_id=p_location_id and bl.business_uid=p_business_id) then
    return false;
  end if;
  if p_actor_app_user_id is null then return true; end if;
  select bm.* into v_membership from mediasis.business_memberships bm
  where bm.business_id=p_business_id and bm.app_user_id=p_actor_app_user_id
    and bm.status='active' and bm.revoked_at is null;
  if not found then return false; end if;
  return v_membership.all_locations or exists(
    select 1 from mediasis.business_membership_locations bml
    where bml.business_membership_id=v_membership.business_membership_id
      and bml.business_location_id=p_location_id and bml.revoked_at is null);
end; $$;

create or replace function mediasis.get_ordering_app_open_hours(p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not mediasis.schedule_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('weekday',o.weekday,'hours',o.hours) order by o.weekday)
    from mediasis.business_location_open_hours_orders o where o.business_location_id=p_location_id),'[]'::jsonb);
end; $$;

create or replace function mediasis.save_ordering_app_open_hours(p_business_id uuid,p_actor_app_user_id uuid,p_location_ids uuid[],p_weekdays jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_location uuid; v_day jsonb;
begin
  if cardinality(coalesce(p_location_ids,'{}'::uuid[]))=0 or jsonb_array_length(coalesce(p_weekdays,'[]'::jsonb))<>7 then
    raise exception 'Invalid schedule payload';
  end if;
  foreach v_location in array p_location_ids loop
    if not mediasis.schedule_actor_location_allowed(p_business_id,p_actor_app_user_id,v_location) then raise exception 'Not authorized'; end if;
  end loop;
  perform 1 from mediasis.business_location bl where bl.business_uid=p_business_id and bl.business_location_id=any(p_location_ids) for update;
  foreach v_location in array p_location_ids loop
    delete from mediasis.business_location_open_hours_orders where business_location_id=v_location;
    for v_day in select value from jsonb_array_elements(p_weekdays) loop
      if (v_day->>'weekday')::integer not between 1 and 7 or jsonb_typeof(v_day->'hours')<>'array' then
        raise exception 'Invalid weekday schedule';
      end if;
      insert into mediasis.business_location_open_hours_orders(business_location_id,weekday,hours)
      values(v_location,(v_day->>'weekday')::smallint,v_day->'hours');
    end loop;
  end loop;
  return jsonb_build_object('success',true,'count',cardinality(p_location_ids));
exception when others then return jsonb_build_object('success',false,'message',sqlerrm); end; $$;

create or replace function mediasis.get_ordering_app_special_hours(p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not mediasis.schedule_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('active_daterange',s.active_daterange::text,
    'closed_all_day',s.closed_all_day,'note',s.note,'hours',s.hours::text) order by lower(s.active_daterange))
    from mediasis.business_location_special_closed_days_orders s where s.business_location_id=p_location_id),'[]'::jsonb);
end; $$;

create or replace function mediasis.save_ordering_app_special_hours(p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid,
  p_active_daterange text,p_closed_all_day boolean,p_hours text,p_note text)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not mediasis.schedule_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  if btrim(coalesce(p_note,''))='' then raise exception 'Note is required'; end if;
  insert into mediasis.business_location_special_closed_days_orders(business_location_id,active_daterange,closed_all_day,hours,note)
  values(p_location_id,p_active_daterange::daterange,p_closed_all_day,
    case when p_closed_all_day then null else p_hours::int4range end,btrim(p_note))
  on conflict(business_location_id,active_daterange) do update set closed_all_day=excluded.closed_all_day,
    hours=excluded.hours,note=excluded.note;
  return jsonb_build_object('success',true);
exception when others then return jsonb_build_object('success',false,'message',sqlerrm); end; $$;

create or replace function mediasis.delete_ordering_app_special_hours(p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid,p_active_daterange text)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not mediasis.schedule_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  delete from mediasis.business_location_special_closed_days_orders
  where business_location_id=p_location_id and active_daterange=p_active_daterange::daterange;
  if not found then raise exception 'Special schedule not found'; end if;
  return jsonb_build_object('success',true);
exception when others then return jsonb_build_object('success',false,'message',sqlerrm); end; $$;

do $$ declare c record; d text; begin
  for c in select oid,conname,conrelid::regclass table_name from pg_catalog.pg_constraint
    where contype='f' and conrelid in ('mediasis.business_location_open_hours_orders'::regclass,
      'mediasis.business_location_special_closed_days_orders'::regclass)
      and confrelid='mediasis.business_location'::regclass and confupdtype<>'c'
  loop
    d:=pg_catalog.pg_get_constraintdef(c.oid);
    d:=pg_catalog.regexp_replace(d,' ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)','','i');
    if d~*' ON DELETE ' then d:=pg_catalog.regexp_replace(d,' ON DELETE ',' ON UPDATE CASCADE ON DELETE ','i');
    else d:=d||' ON UPDATE CASCADE'; end if;
    execute pg_catalog.format('alter table %s drop constraint %I',c.table_name,c.conname);
    execute pg_catalog.format('alter table %s add constraint %I %s',c.table_name,c.conname,d);
  end loop;
end $$;

revoke all on function mediasis.require_ordering_app_schedule_access(uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.schedule_actor_location_allowed(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.get_business_ordering_app_schedules_permission_catalog(uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.get_ordering_app_open_hours(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.save_ordering_app_open_hours(uuid,uuid,uuid[],jsonb) from public,anon,authenticated;
revoke all on function mediasis.get_ordering_app_special_hours(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.save_ordering_app_special_hours(uuid,uuid,uuid,text,boolean,text,text) from public,anon,authenticated;
revoke all on function mediasis.delete_ordering_app_special_hours(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function mediasis.require_ordering_app_schedule_access(uuid,uuid) to service_role;
grant execute on function mediasis.schedule_actor_location_allowed(uuid,uuid,uuid) to service_role;
grant execute on function mediasis.get_business_ordering_app_schedules_permission_catalog(uuid,uuid) to service_role;
grant execute on function mediasis.get_ordering_app_open_hours(uuid,uuid,uuid) to service_role;
grant execute on function mediasis.save_ordering_app_open_hours(uuid,uuid,uuid[],jsonb) to service_role;
grant execute on function mediasis.get_ordering_app_special_hours(uuid,uuid,uuid) to service_role;
grant execute on function mediasis.save_ordering_app_special_hours(uuid,uuid,uuid,text,boolean,text,text) to service_role;
grant execute on function mediasis.delete_ordering_app_special_hours(uuid,uuid,uuid,text) to service_role;

commit;
