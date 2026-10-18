-- Migration: 055
-- Purpose: Authorize complete reservation management for reservation-enabled locations.
-- Apply after migration 054. This file is not applied automatically.

begin;

insert into mediasis.business_permissions (permission_key, name, description, active, archived_at)
values ('reservations.manage.full', 'Administrar reservaciones',
  'Administrar reservaciones, horarios y días cerrados en las ubicaciones permitidas.', true, null)
on conflict (permission_key) do update set name=excluded.name, description=excluded.description,
  active=true, archived_at=null, updated_at=now();

update mediasis.business_permissions
set active=false, archived_at=coalesce(archived_at,now()), updated_at=now()
where permission_key in ('reservations.read','reservations.manage');

insert into mediasis.business_role_permissions (business_role_id,permission_key,revoked_at)
select br.business_role_id,'reservations.manage.full',null
from mediasis.business_roles br
where br.business_id is not null and br.role_key='business_full_access'
  and br.active and br.archived_at is null
on conflict (business_role_id,permission_key) do update set revoked_at=null;

create or replace function mediasis.require_reservations_management_access(p_business_id uuid,p_actor_app_user_id uuid)
returns boolean language plpgsql stable security definer set search_path=''
as $$ begin
  if p_actor_app_user_id is null then return true; end if;
  if not mediasis.team_actor_has_permission(p_business_id,p_actor_app_user_id,'reservations.manage.full') then
    raise exception 'Not authorized';
  end if;
  return true;
end; $$;

create or replace function mediasis.reservation_actor_location_allowed(
  p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid
)
returns boolean language plpgsql stable security definer set search_path=''
as $$ declare v_membership mediasis.business_memberships%rowtype; begin
  perform mediasis.require_reservations_management_access(p_business_id,p_actor_app_user_id);
  if not exists(select 1 from mediasis.business_location bl where bl.business_uid=p_business_id
    and bl.business_location_id=p_location_id and coalesce(bl.reservation_active,false)) then return false; end if;
  if p_actor_app_user_id is null then return true; end if;
  select bm.* into v_membership from mediasis.business_memberships bm
  where bm.business_id=p_business_id and bm.app_user_id=p_actor_app_user_id
    and bm.status='active' and bm.revoked_at is null;
  if not found then return false; end if;
  return v_membership.all_locations or exists(select 1 from mediasis.business_membership_locations bml
    where bml.business_membership_id=v_membership.business_membership_id
      and bml.business_location_id=p_location_id and bml.revoked_at is null);
end; $$;

create or replace function mediasis.current_user_can_manage_reservation_location(p_location_id uuid)
returns boolean language plpgsql stable security definer set search_path=''
as $$ declare v_legacy uuid:=mediasis.current_legacy_business_id(); v_actor uuid:=mediasis.current_business_app_user_id(); v_business uuid; begin
  select bl.business_uid into v_business from mediasis.business_location bl
  where bl.business_location_id=p_location_id and coalesce(bl.reservation_active,false);
  if v_business is null then return false; end if;
  if v_legacy is not null then return v_legacy=v_business; end if;
  if v_actor is null then return false; end if;
  return mediasis.reservation_actor_location_allowed(v_business,v_actor,p_location_id);
end; $$;

create or replace function mediasis.get_dashboard_reservations(
  p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid,p_start_at timestamptz,p_end_at timestamptz
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ begin
  if not mediasis.reservation_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  if p_start_at is null or p_end_at is null or p_end_at<=p_start_at then raise exception 'Invalid date range'; end if;
  return jsonb_build_object('success',true,'data',coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'client',jsonb_build_object('phone_number',c.phone_number,'first_name',c.first_name,'last_name',c.last_name),
    'created_at',r.created_at,'updated_at',r.updated_at,'date',r.date,'size',r.size,'status',r.status,
    'price',r.price,'payment_proof_url',r.payment_proof_url,'extra_details',r.extra_details
  ) order by r.date) from mediasis.reservations r join mediasis.client c on c.phone_number=r.client
  where r.business_location_id=p_location_id and r.date>=p_start_at and r.date<p_end_at),'[]'::jsonb));
end; $$;

create or replace function mediasis.get_dashboard_reservation(
  p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid,p_reservation_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare v_data jsonb; begin
  if not mediasis.reservation_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  select jsonb_build_object('id',r.id,'client',jsonb_build_object('phone_number',c.phone_number,
    'first_name',c.first_name,'last_name',c.last_name),'created_at',r.created_at,'updated_at',r.updated_at,
    'date',r.date,'size',r.size,'status',r.status,'price',r.price,'payment_proof_url',r.payment_proof_url,
    'extra_details',r.extra_details) into v_data
  from mediasis.reservations r join mediasis.client c on c.phone_number=r.client
  where r.id=p_reservation_id and r.business_location_id=p_location_id;
  if v_data is null then raise exception 'Reservation not found'; end if;
  return jsonb_build_object('success',true,'data',v_data);
end; $$;

create or replace function mediasis.update_dashboard_reservation(
  p_business_id uuid,p_actor_app_user_id uuid,p_reservation_id uuid,p_date timestamptz,p_size numeric,p_status text
)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare v_location uuid; v_result jsonb; begin
  select r.business_location_id into v_location from mediasis.reservations r where r.id=p_reservation_id for update;
  if v_location is null or not mediasis.reservation_actor_location_allowed(p_business_id,p_actor_app_user_id,v_location) then
    raise exception 'Not authorized'; end if;
  if p_size is null or p_size<1 or p_size>100 or p_status not in ('pending','confirmed','seated','done','cancelled') then
    raise exception 'Invalid reservation values'; end if;
  -- Decode through the table's composite type so this remains correct even
  -- when the production status enum has a schema-generated name.
  update mediasis.reservations set date=p_date,size=p_size,
    status=(jsonb_populate_record(null::mediasis.reservations,jsonb_build_object('status',p_status))).status,
    updated_at=now()
  where id=p_reservation_id;
  select jsonb_build_object('client_email',c.email,'location_name',bl.short_name,'avatar_url',b.avatar_url)
  into v_result from mediasis.reservations r join mediasis.client c on c.phone_number=r.client
  join mediasis.business_location bl on bl.business_location_id=r.business_location_id
  join mediasis.businesses b on b.uid=bl.business_uid where r.id=p_reservation_id;
  insert into mediasis.authorization_audit_log(actor_app_user_id,business_id,action,target_type,target_id,after_value)
  values(p_actor_app_user_id,p_business_id,'reservation.updated','reservation',p_reservation_id::text,
    jsonb_build_object('date',p_date,'size',p_size,'status',p_status));
  return jsonb_build_object('success',true,'notification',v_result);
exception when others then return jsonb_build_object('success',false,'message',sqlerrm); end; $$;

create or replace function mediasis.get_dashboard_reservation_open_hours(
  p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ begin
  if not mediasis.reservation_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  return jsonb_build_object('success',true,'data',coalesce((select jsonb_agg(jsonb_build_object(
    'weekday',h.weekday,'hours',h.hours) order by h.weekday) from mediasis.business_location_open_hours h
    where h.business_location_id=p_location_id),'[]'::jsonb));
end; $$;

create or replace function mediasis.save_dashboard_reservation_open_hours(
  p_business_id uuid,p_actor_app_user_id uuid,p_location_ids uuid[],p_weekdays jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare v_location uuid; v_day jsonb; begin
  if cardinality(coalesce(p_location_ids,'{}'::uuid[]))=0 or jsonb_array_length(coalesce(p_weekdays,'[]'::jsonb))<>7 then
    raise exception 'Invalid schedule payload'; end if;
  foreach v_location in array p_location_ids loop
    if not mediasis.reservation_actor_location_allowed(p_business_id,p_actor_app_user_id,v_location) then raise exception 'Not authorized'; end if;
  end loop;
  perform 1 from mediasis.business_location bl where bl.business_location_id=any(p_location_ids) for update;
  foreach v_location in array p_location_ids loop
    delete from mediasis.business_location_open_hours where business_location_id=v_location;
    for v_day in select value from jsonb_array_elements(p_weekdays) loop
      if (v_day->>'weekday')::integer not between 1 and 7 or jsonb_typeof(v_day->'hours')<>'array' then
        raise exception 'Invalid weekday schedule'; end if;
      insert into mediasis.business_location_open_hours(business_location_id,weekday,hours)
      values(v_location,(v_day->>'weekday')::smallint,v_day->'hours');
    end loop;
  end loop;
  return jsonb_build_object('success',true,'count',cardinality(p_location_ids));
exception when others then return jsonb_build_object('success',false,'message',sqlerrm); end; $$;

create or replace function mediasis.get_dashboard_reservation_special_hours(
  p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ begin
  if not mediasis.reservation_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  return jsonb_build_object('success',true,'data',coalesce((select jsonb_agg(jsonb_build_object(
    'active_daterange',s.active_daterange::text,'closed_all_day',s.closed_all_day,'note',s.note,'hours',s.hours::text)
    order by lower(s.active_daterange)) from mediasis.business_location_special_closed_days s
    where s.business_location_id=p_location_id),'[]'::jsonb));
end; $$;

create or replace function mediasis.save_dashboard_reservation_special_hours(
  p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid,p_active_daterange text,
  p_closed_all_day boolean,p_hours text,p_note text
)
returns jsonb language plpgsql security definer set search_path=''
as $$ begin
  if not mediasis.reservation_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  if btrim(coalesce(p_note,''))='' then raise exception 'Note is required'; end if;
  insert into mediasis.business_location_special_closed_days(business_location_id,active_daterange,closed_all_day,hours,note)
  values(p_location_id,p_active_daterange::daterange,p_closed_all_day,
    case when p_closed_all_day then null else p_hours::int4range end,btrim(p_note))
  on conflict(business_location_id,active_daterange) do update set closed_all_day=excluded.closed_all_day,
    hours=excluded.hours,note=excluded.note;
  return jsonb_build_object('success',true);
exception when others then return jsonb_build_object('success',false,'message',sqlerrm); end; $$;

create or replace function mediasis.delete_dashboard_reservation_special_hours(
  p_business_id uuid,p_actor_app_user_id uuid,p_location_id uuid,p_active_daterange text
)
returns jsonb language plpgsql security definer set search_path=''
as $$ begin
  if not mediasis.reservation_actor_location_allowed(p_business_id,p_actor_app_user_id,p_location_id) then raise exception 'Not authorized'; end if;
  delete from mediasis.business_location_special_closed_days
  where business_location_id=p_location_id and active_daterange=p_active_daterange::daterange;
  if not found then raise exception 'Special schedule not found'; end if;
  return jsonb_build_object('success',true);
exception when others then return jsonb_build_object('success',false,'message',sqlerrm); end; $$;

create or replace function mediasis.get_dashboard_reservation_domain(p_business_id uuid,p_actor_app_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare v_domain text; begin
  perform mediasis.require_reservations_management_access(p_business_id,p_actor_app_user_id);
  if not exists(select 1 from mediasis.business_location bl where bl.business_uid=p_business_id
    and coalesce(bl.reservation_active,false) and mediasis.reservation_actor_location_allowed(
      p_business_id,p_actor_app_user_id,bl.business_location_id)) then raise exception 'Not authorized'; end if;
  select bd.domain into v_domain from mediasis.business_domain bd
  where bd.business_uid=p_business_id and bd.type='reservation' order by bd.created_at limit 1;
  return jsonb_build_object('success',true,'domain',v_domain);
end; $$;

create or replace function mediasis.get_business_reservations_permission_catalog(p_business_id uuid,p_actor_app_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare v_roles jsonb; begin
  perform mediasis.team_require_permission(p_business_id,p_actor_app_user_id,'members.read');
  select coalesce(jsonb_object_agg(br.business_role_id::text,coalesce(keys.permission_keys,'[]'::jsonb)),'{}'::jsonb)
  into v_roles from mediasis.business_roles br left join lateral (
    select jsonb_agg(brp.permission_key) permission_keys from mediasis.business_role_permissions brp
    where brp.business_role_id=br.business_role_id and brp.permission_key='reservations.manage.full' and brp.revoked_at is null
  ) keys on true where br.business_id=p_business_id and br.active and br.archived_at is null;
  return jsonb_build_object('success',true,'permissions',jsonb_build_array(jsonb_build_object(
    'key','reservations.manage.full','name','Administrar reservaciones',
    'description','Administrar reservaciones, horarios y días cerrados.')),'role_permissions',v_roles);
end; $$;

-- Preserve anonymous reservation-app reads, but stop granting every authenticated dashboard identity all reservations.
drop policy if exists "Enable read access for all users" on mediasis.reservations;
drop policy if exists "dashboard anonymous reservation compatibility" on mediasis.reservations;
create policy "dashboard anonymous reservation compatibility" on mediasis.reservations for select to anon using(true);
drop policy if exists "Authenticated can update their reservations" on mediasis.reservations;
drop policy if exists "authorized dashboard reservation reads" on mediasis.reservations;
drop policy if exists "authorized dashboard reservation updates" on mediasis.reservations;
create policy "authorized dashboard reservation reads" on mediasis.reservations for select to authenticated
using(mediasis.current_user_can_manage_reservation_location(business_location_id));
create policy "authorized dashboard reservation updates" on mediasis.reservations for update to authenticated
using(mediasis.current_user_can_manage_reservation_location(business_location_id))
with check(mediasis.current_user_can_manage_reservation_location(business_location_id));

drop policy if exists "authenticated can insert" on mediasis.business_location_open_hours;
drop policy if exists "authenticated can update open hours" on mediasis.business_location_open_hours;
drop policy if exists "authorized dashboard reservation hours insert" on mediasis.business_location_open_hours;
drop policy if exists "authorized dashboard reservation hours update" on mediasis.business_location_open_hours;
create policy "authorized dashboard reservation hours insert" on mediasis.business_location_open_hours for insert to authenticated
with check(mediasis.current_user_can_manage_reservation_location(business_location_id));
create policy "authorized dashboard reservation hours update" on mediasis.business_location_open_hours for update to authenticated
using(mediasis.current_user_can_manage_reservation_location(business_location_id))
with check(mediasis.current_user_can_manage_reservation_location(business_location_id));

drop policy if exists "business can delete their closed/special days" on mediasis.business_location_special_closed_days;
drop policy if exists "business can insert closed days" on mediasis.business_location_special_closed_days;
drop policy if exists "business can update closed days" on mediasis.business_location_special_closed_days;
drop policy if exists "authorized dashboard reservation closed days mutations" on mediasis.business_location_special_closed_days;
create policy "authorized dashboard reservation closed days mutations" on mediasis.business_location_special_closed_days
for all to authenticated using(mediasis.current_user_can_manage_reservation_location(business_location_id))
with check(mediasis.current_user_can_manage_reservation_location(business_location_id));

do $$ declare c record; d text; begin
  for c in select oid,conname,conrelid::regclass table_name from pg_catalog.pg_constraint
    where contype='f' and conrelid in ('mediasis.reservations'::regclass,'mediasis.business_location_open_hours'::regclass,
      'mediasis.business_location_special_closed_days'::regclass)
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

revoke all on function mediasis.require_reservations_management_access(uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.reservation_actor_location_allowed(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.current_user_can_manage_reservation_location(uuid) from public,anon;
revoke all on function mediasis.get_dashboard_reservations(uuid,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function mediasis.get_dashboard_reservation(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.update_dashboard_reservation(uuid,uuid,uuid,timestamptz,numeric,text) from public,anon,authenticated;
revoke all on function mediasis.get_dashboard_reservation_open_hours(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.save_dashboard_reservation_open_hours(uuid,uuid,uuid[],jsonb) from public,anon,authenticated;
revoke all on function mediasis.get_dashboard_reservation_special_hours(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.save_dashboard_reservation_special_hours(uuid,uuid,uuid,text,boolean,text,text) from public,anon,authenticated;
revoke all on function mediasis.delete_dashboard_reservation_special_hours(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function mediasis.get_dashboard_reservation_domain(uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.get_business_reservations_permission_catalog(uuid,uuid) from public,anon,authenticated;
grant execute on function mediasis.require_reservations_management_access(uuid,uuid) to service_role;
grant execute on function mediasis.reservation_actor_location_allowed(uuid,uuid,uuid) to service_role;
grant execute on function mediasis.get_dashboard_reservations(uuid,uuid,uuid,timestamptz,timestamptz) to service_role;
grant execute on function mediasis.get_dashboard_reservation(uuid,uuid,uuid,uuid) to service_role;
grant execute on function mediasis.update_dashboard_reservation(uuid,uuid,uuid,timestamptz,numeric,text) to service_role;
grant execute on function mediasis.get_dashboard_reservation_open_hours(uuid,uuid,uuid) to service_role;
grant execute on function mediasis.save_dashboard_reservation_open_hours(uuid,uuid,uuid[],jsonb) to service_role;
grant execute on function mediasis.get_dashboard_reservation_special_hours(uuid,uuid,uuid) to service_role;
grant execute on function mediasis.save_dashboard_reservation_special_hours(uuid,uuid,uuid,text,boolean,text,text) to service_role;
grant execute on function mediasis.delete_dashboard_reservation_special_hours(uuid,uuid,uuid,text) to service_role;
grant execute on function mediasis.get_dashboard_reservation_domain(uuid,uuid) to service_role;
grant execute on function mediasis.get_business_reservations_permission_catalog(uuid,uuid) to service_role;
grant execute on function mediasis.current_user_can_manage_reservation_location(uuid) to authenticated,service_role;

commit;
