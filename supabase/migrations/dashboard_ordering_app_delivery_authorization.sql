-- Migration: 049
-- Purpose: Authorize delivery configuration with location-scoped assignments.
-- Apply after migration 048. This file is not applied automatically.

begin;

insert into mediasis.business_permissions (permission_key, name, description, active, archived_at)
values (
  'ordering_app.delivery.manage.full',
  'Administrar delivery',
  'Administrar métodos de delivery y su configuración en las ubicaciones permitidas.',
  true,
  null
)
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key)
select br.business_role_id, 'ordering_app.delivery.manage.full'
from mediasis.business_roles br
where br.business_id is not null
  and br.role_key = 'business_full_access'
  and br.active
  and br.archived_at is null
on conflict (business_role_id, permission_key) do update set revoked_at = null;

create or replace function mediasis.require_ordering_app_delivery_access(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The function is service-role-only. A null actor denotes the separately
  -- validated legacy Supabase owner path in the dashboard server.
  if p_actor_app_user_id is null then return true; end if;
  if not mediasis.team_actor_has_permission(
    p_business_id,
    p_actor_app_user_id,
    'ordering_app.delivery.manage.full'
  ) then
    raise exception 'Not authorized';
  end if;
  return true;
end;
$$;

create or replace function mediasis.get_business_ordering_app_delivery_permission_catalog(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role_permissions jsonb;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.read');
  select coalesce(
    jsonb_object_agg(br.business_role_id::text, coalesce(keys.permission_keys, '[]'::jsonb)),
    '{}'::jsonb
  )
  into v_role_permissions
  from mediasis.business_roles br
  left join lateral (
    select jsonb_agg(brp.permission_key order by brp.permission_key) permission_keys
    from mediasis.business_role_permissions brp
    where brp.business_role_id = br.business_role_id
      and brp.permission_key = 'ordering_app.delivery.manage.full'
      and brp.revoked_at is null
  ) keys on true
  where br.business_id = p_business_id
    and br.active
    and br.archived_at is null;

  return jsonb_build_object(
    'success', true,
    'permissions', jsonb_build_array(jsonb_build_object(
      'key', 'ordering_app.delivery.manage.full',
      'name', 'Administrar delivery',
      'description', 'Administrar métodos de delivery y sus ubicaciones permitidas.'
    )),
    'role_permissions', v_role_permissions
  );
end;
$$;

create or replace function mediasis.save_ordering_app_delivery_method(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_record_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_all_locations boolean;
  v_method_id uuid := nullif(p_payload->>'delivery_method_id', '')::uuid;
  v_record_id uuid := p_record_id;
  v_requested_locations uuid[];
  v_protected_locations uuid[] := '{}'::uuid[];
  v_final_locations uuid[];
  v_payment_methods uuid[];
  v_existing_scope text;
  v_final_scope text;
  v_pickup_minutes integer;
begin
  perform mediasis.require_ordering_app_delivery_access(p_business_id, p_actor_app_user_id);

  if p_actor_app_user_id is null then
    v_all_locations := true;
  else
    select bm.business_membership_id, bm.all_locations
    into v_membership_id, v_all_locations
    from mediasis.business_memberships bm
    where bm.business_id = p_business_id
      and bm.app_user_id = p_actor_app_user_id
      and bm.status = 'active'
      and bm.revoked_at is null
    for update;
    if not found then raise exception 'Not authorized'; end if;
  end if;

  perform 1 from mediasis.businesses b where b.uid = p_business_id and coalesce(b.active, false) for update;
  if not found then raise exception 'Business not found'; end if;
  if not exists (select 1 from mediasis.delivery_methods dm where dm.id = v_method_id) then
    raise exception 'Invalid delivery method';
  end if;

  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
  into v_requested_locations
  from jsonb_array_elements_text(coalesce(p_payload->'business_location_id', '[]'::jsonb));

  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
  into v_payment_methods
  from jsonb_array_elements_text(coalesce(p_payload->'payment_methods', '[]'::jsonb));

  if exists (
    select 1 from unnest(v_requested_locations) requested(id)
    left join mediasis.business_location bl
      on bl.business_location_id = requested.id and bl.business_uid = p_business_id
    where bl.business_location_id is null
  ) then raise exception 'Invalid business location'; end if;

  if exists (
    select 1 from unnest(v_payment_methods) requested(id)
    left join mediasis.business_payment_method bpm
      on bpm.business_payment_method_id = requested.id and bpm.business_id = p_business_id
    where bpm.business_payment_method_id is null
  ) then raise exception 'Invalid payment method'; end if;

  if v_record_id is not null then
    select dmb.scope::text into v_existing_scope
    from mediasis.delivery_methods_business dmb
    where dmb.uid = v_record_id and dmb.business_id = p_business_id
    for update;
    if not found then raise exception 'Delivery method not found'; end if;
  end if;

  if v_all_locations then
    v_final_locations := v_requested_locations;
  else
    if exists (
      select 1 from unnest(v_requested_locations) requested(id)
      where not exists (
        select 1 from mediasis.business_membership_locations bml
        where bml.business_membership_id = v_membership_id
          and bml.business_location_id = requested.id
          and bml.revoked_at is null
      )
    ) then raise exception 'Not allowed for this business location'; end if;

    if v_existing_scope = 'all' then
      -- A restricted editor may change global fields, but cannot narrow an
      -- all-location method by omitting locations hidden from the browser.
      v_final_locations := '{}'::uuid[];
    else
      select coalesce(array_agg(dmbl.business_location_id), '{}'::uuid[])
      into v_protected_locations
      from mediasis.delivery_methods_business_location dmbl
      where dmbl.delivery_methods_business_id = v_record_id
        and not exists (
          select 1 from mediasis.business_membership_locations bml
          where bml.business_membership_id = v_membership_id
            and bml.business_location_id = dmbl.business_location_id
            and bml.revoked_at is null
        );
      select coalesce(array_agg(distinct id), '{}'::uuid[])
      into v_final_locations
      from unnest(v_requested_locations || v_protected_locations) requested(id);
      if v_record_id is null and cardinality(v_final_locations) = 0 then
        raise exception 'Select at least one permitted location';
      end if;
    end if;
  end if;

  v_final_scope := case when cardinality(v_final_locations) = 0 then 'all' else 'specific' end;
  v_pickup_minutes := greatest(1, least(180, coalesce((p_payload->>'pickup_ready_offset_minutes')::integer, 5)));

  if v_record_id is null then
    insert into mediasis.delivery_methods_business (
      visibility, name, instructions, fee, min_order_value, free_delivery_value,
      require_location, require_courier, options, delivery_method_id, business_id, scope
    ) values (
      coalesce((p_payload->>'visibility')::boolean, true), btrim(p_payload->>'name'),
      nullif(btrim(coalesce(p_payload->>'instructions', '')), ''),
      case
        when coalesce(p_payload->'fee', 'null'::jsonb) in ('null'::jsonb, '0'::jsonb) then null
        else p_payload->'fee'
      end,
      nullif((p_payload->>'min_order_value')::numeric, 0),
      nullif((p_payload->>'free_delivery_value')::numeric, 0),
      coalesce((p_payload->>'require_location')::boolean, false),
      coalesce((p_payload->>'require_courier')::boolean, false),
      nullif(p_payload->'options', '[]'::jsonb), v_method_id, p_business_id, v_final_scope::mediasis.scope
    ) returning uid into v_record_id;
  else
    update mediasis.delivery_methods_business
    set visibility = coalesce((p_payload->>'visibility')::boolean, true),
        name = btrim(p_payload->>'name'),
        instructions = nullif(btrim(coalesce(p_payload->>'instructions', '')), ''),
        fee = case
          when coalesce(p_payload->'fee', 'null'::jsonb) in ('null'::jsonb, '0'::jsonb) then null
          else p_payload->'fee'
        end,
        min_order_value = nullif((p_payload->>'min_order_value')::numeric, 0),
        free_delivery_value = nullif((p_payload->>'free_delivery_value')::numeric, 0),
        require_location = coalesce((p_payload->>'require_location')::boolean, false),
        require_courier = coalesce((p_payload->>'require_courier')::boolean, false),
        options = nullif(p_payload->'options', '[]'::jsonb),
        delivery_method_id = v_method_id,
        scope = v_final_scope::mediasis.scope
    where uid = v_record_id and business_id = p_business_id;
  end if;

  delete from mediasis.delivery_methods_business_location
  where delivery_methods_business_id = v_record_id;
  insert into mediasis.delivery_methods_business_location (delivery_methods_business_id, business_location_id)
  select v_record_id, id from unnest(v_final_locations) requested(id) on conflict do nothing;

  delete from mediasis.business_delivery_methods_payment
  where business_delivery_method_id = v_record_id;
  insert into mediasis.business_delivery_methods_payment (business_delivery_method_id, business_payment_method_id)
  select v_record_id, id from unnest(v_payment_methods) requested(id) on conflict do nothing;

  if p_record_id is null then
    insert into mediasis.delivery_method_business_pickup_offset_location (
      business_delivery_method_id, business_location_id, pickup_ready_offset
    )
    select v_record_id, bl.business_location_id, pg_catalog.make_interval(mins => v_pickup_minutes)
    from mediasis.business_location bl
    where bl.business_uid = p_business_id
      and (v_final_scope = 'all' or bl.business_location_id = any(v_final_locations))
    on conflict (business_delivery_method_id, business_location_id)
    do update set pickup_ready_offset = excluded.pickup_ready_offset;
  end if;

  return jsonb_build_object('success', true, 'record_id', v_record_id);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

create or replace function mediasis.delete_ordering_app_delivery_method(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_all_locations boolean;
begin
  perform mediasis.require_ordering_app_delivery_access(p_business_id, p_actor_app_user_id);
  if p_actor_app_user_id is null then
    v_all_locations := true;
  else
    select bm.all_locations into v_all_locations
    from mediasis.business_memberships bm
    where bm.business_id = p_business_id and bm.app_user_id = p_actor_app_user_id
      and bm.status = 'active' and bm.revoked_at is null
    for update;
  end if;
  if not coalesce(v_all_locations, false) then raise exception 'All-location access required'; end if;
  delete from mediasis.delivery_methods_business where uid = p_record_id and business_id = p_business_id;
  if not found then raise exception 'Delivery method not found'; end if;
  return jsonb_build_object('success', true);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

-- Updating a location identifier must carry its delivery assignments and
-- pickup offsets with it. Preserve each constraint's existing delete action.
do $$
declare
  v_constraint record;
  v_definition text;
begin
  for v_constraint in
    select c.oid, c.conname, c.conrelid::regclass as table_name
    from pg_catalog.pg_constraint c
    where c.contype = 'f'
      and c.conrelid in (
        'mediasis.delivery_methods_business_location'::regclass,
        'mediasis.delivery_method_business_pickup_offset_location'::regclass
      )
      and c.confrelid = 'mediasis.business_location'::regclass
      and c.confupdtype <> 'c'
  loop
    v_definition := pg_catalog.pg_get_constraintdef(v_constraint.oid);
    v_definition := pg_catalog.regexp_replace(
      v_definition,
      ' ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)',
      '', 'i'
    );
    if v_definition ~* ' ON DELETE ' then
      v_definition := pg_catalog.regexp_replace(v_definition, ' ON DELETE ', ' ON UPDATE CASCADE ON DELETE ', 'i');
    else
      v_definition := v_definition || ' ON UPDATE CASCADE';
    end if;
    execute pg_catalog.format('alter table %s drop constraint %I', v_constraint.table_name, v_constraint.conname);
    execute pg_catalog.format('alter table %s add constraint %I %s', v_constraint.table_name, v_constraint.conname, v_definition);
  end loop;
end $$;

revoke all on function mediasis.require_ordering_app_delivery_access(uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.get_business_ordering_app_delivery_permission_catalog(uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.save_ordering_app_delivery_method(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function mediasis.delete_ordering_app_delivery_method(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function mediasis.require_ordering_app_delivery_access(uuid, uuid) to service_role;
grant execute on function mediasis.get_business_ordering_app_delivery_permission_catalog(uuid, uuid) to service_role;
grant execute on function mediasis.save_ordering_app_delivery_method(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function mediasis.delete_ordering_app_delivery_method(uuid, uuid, uuid) to service_role;

commit;

-- Rollback circuit breaker:
-- revoke execute on function mediasis.save_ordering_app_delivery_method(uuid, uuid, uuid, jsonb) from service_role;
-- revoke execute on function mediasis.delete_ordering_app_delivery_method(uuid, uuid, uuid) from service_role;
