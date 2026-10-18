-- Migration: 052
-- Purpose: Allow administrators to grant every active business permission they personally hold.
-- Apply after migration 051. This file is not applied automatically.

begin;

-- Migration 041 intentionally started with a small permission catalogue, but its
-- role mutation functions encoded that initial list directly. Later authorization
-- slices add active permissions to the same catalogue, so the catalogue—not a
-- historical hardcoded list—must determine which keys are assignable.
create or replace function mediasis.create_business_custom_role(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_name text,
  p_description text,
  p_permission_keys text[],
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_key text := 'custom_' || replace(p_idempotency_key::text, '-', '');
  v_permission text;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'roles.manage');
  if nullif(pg_catalog.btrim(p_name), '') is null then
    raise exception 'Role name is required';
  end if;
  if cardinality(coalesce(p_permission_keys, '{}'::text[])) = 0 then
    raise exception 'Select at least one permission';
  end if;

  foreach v_permission in array p_permission_keys loop
    if not exists (
      select 1
      from mediasis.business_permissions bp
      where bp.permission_key = v_permission
        and bp.active
        and bp.archived_at is null
    ) or not mediasis.team_actor_has_permission(
      p_business_id, p_actor_app_user_id, v_permission
    ) then
      raise exception 'You cannot grant permission %', v_permission;
    end if;
  end loop;

  insert into mediasis.business_roles (
    business_id, role_key, name, description, role_origin, is_editable
  ) values (
    p_business_id, v_key, pg_catalog.btrim(p_name),
    nullif(pg_catalog.btrim(p_description), ''), 'custom', true
  )
  on conflict (business_id, role_key) do update set updated_at = now()
  returning business_role_id into v_role_id;

  foreach v_permission in array p_permission_keys loop
    insert into mediasis.business_role_permissions (
      business_role_id, permission_key, revoked_at
    ) values (v_role_id, v_permission, null)
    on conflict (business_role_id, permission_key)
    do update set revoked_at = null;
  end loop;

  return jsonb_build_object('success', true, 'role_id', v_role_id);
end;
$$;

create or replace function mediasis.update_business_custom_role(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_role_id uuid,
  p_name text,
  p_description text,
  p_permission_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_permission text;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'roles.manage');

  perform 1
  from mediasis.business_roles br
  where br.business_role_id = p_business_role_id
    and br.business_id = p_business_id
    and br.role_origin = 'custom'
    and br.is_editable
    and br.active
    and br.archived_at is null
  for update;
  if not found then
    raise exception 'Only active custom roles can be edited';
  end if;

  if nullif(pg_catalog.btrim(p_name), '') is null then
    raise exception 'Role name is required';
  end if;
  if cardinality(coalesce(p_permission_keys, '{}'::text[])) = 0 then
    raise exception 'Select at least one permission';
  end if;

  foreach v_permission in array p_permission_keys loop
    if not exists (
      select 1
      from mediasis.business_permissions bp
      where bp.permission_key = v_permission
        and bp.active
        and bp.archived_at is null
    ) or not mediasis.team_actor_has_permission(
      p_business_id, p_actor_app_user_id, v_permission
    ) then
      raise exception 'You cannot grant permission %', v_permission;
    end if;
  end loop;

  update mediasis.business_roles
  set name = pg_catalog.btrim(p_name),
      description = nullif(pg_catalog.btrim(p_description), ''),
      updated_at = now()
  where business_role_id = p_business_role_id;

  update mediasis.business_role_permissions
  set revoked_at = coalesce(revoked_at, now())
  where business_role_id = p_business_role_id
    and revoked_at is null;

  foreach v_permission in array p_permission_keys loop
    insert into mediasis.business_role_permissions (
      business_role_id, permission_key, revoked_at
    ) values (p_business_role_id, v_permission, null)
    on conflict (business_role_id, permission_key)
    do update set revoked_at = null;
  end loop;

  return jsonb_build_object('success', true, 'role_id', p_business_role_id);
end;
$$;

revoke all on function mediasis.create_business_custom_role(uuid,uuid,text,text,text[],uuid)
  from public, anon, authenticated;
revoke all on function mediasis.update_business_custom_role(uuid,uuid,uuid,text,text,text[])
  from public, anon, authenticated;
grant execute on function mediasis.create_business_custom_role(uuid,uuid,text,text,text[],uuid)
  to service_role;
grant execute on function mediasis.update_business_custom_role(uuid,uuid,uuid,text,text,text[])
  to service_role;

commit;
