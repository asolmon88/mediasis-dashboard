-- Migration: 054
-- Purpose: Authorize automatic order-status configuration with location-scoped assignments.
-- Apply after migration 053. This file is not applied automatically.

begin;

insert into mediasis.business_permissions (permission_key, name, description, active, archived_at)
values (
  'dashboard_app.automatic_statuses.manage.full',
  'Administrar estados automáticos',
  'Administrar los estados automáticos en las ubicaciones permitidas.',
  true,
  null
)
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key, revoked_at)
select br.business_role_id, 'dashboard_app.automatic_statuses.manage.full', null
from mediasis.business_roles br
where br.business_id is not null
  and br.role_key = 'business_full_access'
  and br.active
  and br.archived_at is null
on conflict (business_role_id, permission_key) do update set revoked_at = null;

create or replace function mediasis.require_dashboard_automatic_statuses_access(
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
  -- A null actor is the explicitly validated legacy-owner path used by the server.
  if p_actor_app_user_id is null then return true; end if;
  if not mediasis.team_actor_has_permission(
    p_business_id,
    p_actor_app_user_id,
    'dashboard_app.automatic_statuses.manage.full'
  ) then
    raise exception 'Not authorized';
  end if;
  return true;
end;
$$;

create or replace function mediasis.dashboard_automatic_statuses_actor_all_locations(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_all_locations boolean;
begin
  perform mediasis.require_dashboard_automatic_statuses_access(p_business_id, p_actor_app_user_id);
  if p_actor_app_user_id is null then return true; end if;
  select bm.all_locations into v_all_locations
  from mediasis.business_memberships bm
  where bm.business_id = p_business_id
    and bm.app_user_id = p_actor_app_user_id
    and bm.status = 'active'
    and bm.revoked_at is null;
  return coalesce(v_all_locations, false);
end;
$$;

create or replace function mediasis.get_dashboard_automatic_status_settings(
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
  v_all_locations boolean;
  v_global_active boolean;
  v_selected uuid[];
  v_locations jsonb;
begin
  perform mediasis.require_dashboard_automatic_statuses_access(p_business_id, p_actor_app_user_id);
  v_all_locations := mediasis.dashboard_automatic_statuses_actor_all_locations(p_business_id, p_actor_app_user_id);

  select exists (
    select 1 from mediasis.order_status_automation_config c
    where c.business_id = p_business_id and c.business_location_id is null and c.enabled
  ) into v_global_active;

  select coalesce(array_agg(c.business_location_id order by c.business_location_id), '{}'::uuid[])
  into v_selected
  from mediasis.order_status_automation_config c
  where c.business_id = p_business_id
    and c.business_location_id is not null
    and c.enabled
    and (
      v_all_locations or exists (
        select 1
        from mediasis.business_memberships bm
        join mediasis.business_membership_locations bml
          on bml.business_membership_id = bm.business_membership_id
         and bml.revoked_at is null
        where bm.business_id = p_business_id
          and bm.app_user_id = p_actor_app_user_id
          and bm.status = 'active'
          and bm.revoked_at is null
          and bml.business_location_id = c.business_location_id
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'business_location_id', bl.business_location_id,
    'short_name', bl.short_name
  ) order by bl.short_name), '[]'::jsonb)
  into v_locations
  from mediasis.business_location bl
  where bl.business_uid = p_business_id
    and (
      v_all_locations or exists (
        select 1
        from mediasis.business_memberships bm
        join mediasis.business_membership_locations bml
          on bml.business_membership_id = bm.business_membership_id
         and bml.revoked_at is null
        where bm.business_id = p_business_id
          and bm.app_user_id = p_actor_app_user_id
          and bm.status = 'active'
          and bm.revoked_at is null
          and bml.business_location_id = bl.business_location_id
      )
    );

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'enabled', case when v_global_active then true else cardinality(v_selected) > 0 end,
      'available_everywhere', v_global_active,
      'global_configuration_active', v_global_active,
      'selected_location_ids', to_jsonb(v_selected),
      'locations', v_locations
    )
  );
end;
$$;

create or replace function mediasis.save_dashboard_automatic_status_settings(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_enabled boolean,
  p_available_everywhere boolean,
  p_location_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_all_locations boolean;
  v_global_active boolean;
  v_location_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  perform mediasis.require_dashboard_automatic_statuses_access(p_business_id, p_actor_app_user_id);
  v_all_locations := mediasis.dashboard_automatic_statuses_actor_all_locations(p_business_id, p_actor_app_user_id);
  p_location_ids := coalesce(p_location_ids, '{}'::uuid[]);

  -- Serializes even when the business has no configuration rows yet.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text, 0));
  perform 1 from mediasis.order_status_automation_config c
  where c.business_id = p_business_id for update;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.business_location_id nulls first), '[]'::jsonb)
  into v_before
  from mediasis.order_status_automation_config c where c.business_id = p_business_id;

  select exists (
    select 1 from mediasis.order_status_automation_config c
    where c.business_id = p_business_id and c.business_location_id is null and c.enabled
  ) into v_global_active;

  foreach v_location_id in array p_location_ids loop
    if not exists (
      select 1 from mediasis.business_location bl
      where bl.business_uid = p_business_id and bl.business_location_id = v_location_id
    ) then raise exception 'Not authorized'; end if;
    if not v_all_locations and not exists (
      select 1
      from mediasis.business_memberships bm
      join mediasis.business_membership_locations bml
        on bml.business_membership_id = bm.business_membership_id
       and bml.revoked_at is null
      where bm.business_id = p_business_id
        and bm.app_user_id = p_actor_app_user_id
        and bm.status = 'active'
        and bm.revoked_at is null
        and bml.business_location_id = v_location_id
    ) then raise exception 'Not authorized'; end if;
  end loop;

  if v_all_locations then
    if p_enabled and not p_available_everywhere and cardinality(p_location_ids) = 0 then
      raise exception 'Select at least one business location';
    end if;
    delete from mediasis.order_status_automation_config c where c.business_id = p_business_id;
    if p_enabled and p_available_everywhere then
      insert into mediasis.order_status_automation_config (business_id, business_location_id, enabled)
      values (p_business_id, null, true);
    elsif p_enabled then
      insert into mediasis.order_status_automation_config (business_id, business_location_id, enabled)
      select p_business_id, location_id, true
      from (select distinct unnest(p_location_ids) as location_id) submitted;
    end if;
  else
    if p_available_everywhere then
      if v_global_active and p_enabled then
        return jsonb_build_object('success', true);
      end if;
      raise exception 'Cannot change global configuration without all-location access';
    end if;
    if v_global_active then
      raise exception 'Cannot change global configuration without all-location access';
    end if;

    -- Delete and rebuild only assignments inside the actor's authorized scope.
    delete from mediasis.order_status_automation_config c
    where c.business_id = p_business_id
      and c.business_location_id in (
        select bml.business_location_id
        from mediasis.business_memberships bm
        join mediasis.business_membership_locations bml
          on bml.business_membership_id = bm.business_membership_id
         and bml.revoked_at is null
        where bm.business_id = p_business_id
          and bm.app_user_id = p_actor_app_user_id
          and bm.status = 'active'
          and bm.revoked_at is null
      );
    if p_enabled then
      if cardinality(p_location_ids) = 0 then raise exception 'Select at least one business location'; end if;
      insert into mediasis.order_status_automation_config (business_id, business_location_id, enabled)
      select p_business_id, location_id, true
      from (select distinct unnest(p_location_ids) as location_id) submitted;
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.business_location_id nulls first), '[]'::jsonb)
  into v_after from mediasis.order_status_automation_config c where c.business_id = p_business_id;

  insert into mediasis.authorization_audit_log (
    actor_app_user_id, business_id, action, target_type, target_id, before_value, after_value
  ) values (
    p_actor_app_user_id, p_business_id, 'dashboard_app.automatic_statuses.updated',
    'order_status_automation_config', p_business_id::text, v_before, v_after
  );
  return jsonb_build_object('success', true);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

create or replace function mediasis.get_business_dashboard_automatic_statuses_permission_catalog(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_roles jsonb;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.read');
  select coalesce(jsonb_object_agg(br.business_role_id::text, coalesce(keys.permission_keys, '[]'::jsonb)), '{}'::jsonb)
  into v_roles
  from mediasis.business_roles br
  left join lateral (
    select jsonb_agg(brp.permission_key) permission_keys
    from mediasis.business_role_permissions brp
    where brp.business_role_id = br.business_role_id
      and brp.permission_key = 'dashboard_app.automatic_statuses.manage.full'
      and brp.revoked_at is null
  ) keys on true
  where br.business_id = p_business_id and br.active and br.archived_at is null;
  return jsonb_build_object(
    'success', true,
    'permissions', jsonb_build_array(jsonb_build_object(
      'key', 'dashboard_app.automatic_statuses.manage.full',
      'name', 'Administrar estados automáticos',
      'description', 'Administrar estados automáticos en las ubicaciones permitidas.'
    )),
    'role_permissions', v_roles
  );
end;
$$;

do $$
declare c record; definition text;
begin
  for c in
    select pc.oid, pc.conname, pc.conrelid::regclass table_name
    from pg_catalog.pg_constraint pc
    where pc.contype = 'f'
      and pc.conrelid = 'mediasis.order_status_automation_config'::regclass
      and pc.confrelid = 'mediasis.business_location'::regclass
      and pc.confupdtype <> 'c'
  loop
    definition := pg_catalog.pg_get_constraintdef(c.oid);
    definition := pg_catalog.regexp_replace(definition, ' ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)', '', 'i');
    if definition ~* ' ON DELETE ' then
      definition := pg_catalog.regexp_replace(definition, ' ON DELETE ', ' ON UPDATE CASCADE ON DELETE ', 'i');
    else definition := definition || ' ON UPDATE CASCADE'; end if;
    execute pg_catalog.format('alter table %s drop constraint %I', c.table_name, c.conname);
    execute pg_catalog.format('alter table %s add constraint %I %s', c.table_name, c.conname, definition);
  end loop;
end $$;

revoke all on function mediasis.require_dashboard_automatic_statuses_access(uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.dashboard_automatic_statuses_actor_all_locations(uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.get_dashboard_automatic_status_settings(uuid,uuid) from public,anon,authenticated;
revoke all on function mediasis.save_dashboard_automatic_status_settings(uuid,uuid,boolean,boolean,uuid[]) from public,anon,authenticated;
revoke all on function mediasis.get_business_dashboard_automatic_statuses_permission_catalog(uuid,uuid) from public,anon,authenticated;
grant execute on function mediasis.require_dashboard_automatic_statuses_access(uuid,uuid) to service_role;
grant execute on function mediasis.dashboard_automatic_statuses_actor_all_locations(uuid,uuid) to service_role;
grant execute on function mediasis.get_dashboard_automatic_status_settings(uuid,uuid) to service_role;
grant execute on function mediasis.save_dashboard_automatic_status_settings(uuid,uuid,boolean,boolean,uuid[]) to service_role;
grant execute on function mediasis.get_business_dashboard_automatic_statuses_permission_catalog(uuid,uuid) to service_role;

commit;
