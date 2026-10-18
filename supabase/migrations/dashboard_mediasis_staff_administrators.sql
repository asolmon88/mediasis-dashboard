-- Migration: 058
-- Purpose: Add true Mediasis staff administration with all-business access.
-- Apply after migration 057. This file is not applied automatically.

begin;

create or replace function mediasis.is_mediasis_staff_actor(p_app_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_app_user_id is not null and exists (
    select 1
    from mediasis.app_users au
    join mediasis.staff_memberships sm
      on sm.app_user_id = au.app_user_id
     and sm.status = 'active'
     and sm.revoked_at is null
    join mediasis.staff_roles sr
      on sr.staff_role_id = sm.staff_role_id
     and sr.active
     and sr.archived_at is null
     and sr.grants_all_businesses
    where au.app_user_id = p_app_user_id
      and au.status = 'active'
      and au.deleted_at is null
  );
$$;

create or replace function mediasis.is_current_mediasis_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select mediasis.is_mediasis_staff_actor(mediasis.current_business_app_user_id());
$$;

-- Staff access is deliberately separate from pharmacy membership. Pharmacy
-- users still require an active membership; an Mediasis staff member receives
-- access only through the protected all-business staff role.
create or replace function mediasis.has_business_access(requested_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_business_id is not null
    and exists (
      select 1 from mediasis.businesses b
      where b.uid = requested_business_id and coalesce(b.active, false)
    )
    and (
      mediasis.current_legacy_business_id() = requested_business_id
      or mediasis.is_current_mediasis_staff()
      or exists (
        select 1
        from mediasis.business_memberships bm
        where bm.business_id = requested_business_id
          and bm.app_user_id = mediasis.current_business_app_user_id()
          and bm.status = 'active'
          and bm.revoked_at is null
      )
    );
$$;

create or replace function mediasis.has_business_permission(
  requested_business_id uuid,
  requested_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_business_id is not null
    and requested_permission_key is not null
    and exists (
      select 1 from mediasis.businesses b
      where b.uid = requested_business_id and coalesce(b.active, false)
    )
    and (
      mediasis.current_legacy_business_id() = requested_business_id
      or (
        mediasis.is_current_mediasis_staff()
        and exists (
          select 1
          from mediasis.business_permissions bp
          where bp.permission_key = requested_permission_key
            and bp.active and bp.archived_at is null
        )
      )
      or exists (
        select 1
        from mediasis.business_memberships bm
        join mediasis.business_membership_roles bmr
          on bmr.business_membership_id = bm.business_membership_id
         and bmr.business_id = bm.business_id and bmr.revoked_at is null
        join mediasis.business_roles br
          on br.business_role_id = bmr.business_role_id
         and br.business_id = bm.business_id and br.active and br.archived_at is null
        join mediasis.business_role_permissions brp
          on brp.business_role_id = br.business_role_id and brp.revoked_at is null
        join mediasis.business_permissions bp
          on bp.permission_key = brp.permission_key and bp.active and bp.archived_at is null
        where bm.business_id = requested_business_id
          and bm.app_user_id = mediasis.current_business_app_user_id()
          and bm.status = 'active' and bm.revoked_at is null
          and bp.permission_key = requested_permission_key
      )
    );
$$;

create or replace function mediasis.has_location_permission(
  requested_location_id uuid,
  requested_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_location_id is not null
    and requested_permission_key is not null
    and exists (
      select 1
      from mediasis.business_location bl
      where bl.business_location_id = requested_location_id
        and mediasis.has_business_permission(bl.business_uid, requested_permission_key)
        and (
          mediasis.current_legacy_business_id() = bl.business_uid
          or mediasis.is_current_mediasis_staff()
          or exists (
            select 1
            from mediasis.business_memberships bm
            where bm.business_id = bl.business_uid
              and bm.app_user_id = mediasis.current_business_app_user_id()
              and bm.status = 'active' and bm.revoked_at is null
              and (
                bm.all_locations
                or exists (
                  select 1 from mediasis.business_membership_locations bml
                  where bml.business_membership_id = bm.business_membership_id
                    and bml.business_id = bm.business_id
                    and bml.business_location_id = requested_location_id
                    and bml.revoked_at is null
                )
              )
          )
        )
    );
$$;

create or replace function mediasis.team_actor_has_permission(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_business_id is not null
    and p_permission_key is not null
    and exists (
      select 1 from mediasis.businesses b
      where b.uid = p_business_id and coalesce(b.active, false)
    )
    and (
      (
        mediasis.is_mediasis_staff_actor(p_actor_app_user_id)
        and exists (
          select 1 from mediasis.business_permissions bp
          where bp.permission_key = p_permission_key
            and bp.active and bp.archived_at is null
        )
      )
      or exists (
        select 1
        from mediasis.app_users au
        join mediasis.business_memberships bm on bm.app_user_id = au.app_user_id
        join mediasis.business_membership_roles bmr
          on bmr.business_membership_id = bm.business_membership_id
         and bmr.business_id = bm.business_id and bmr.revoked_at is null
        join mediasis.business_roles br
          on br.business_role_id = bmr.business_role_id
         and br.business_id = bm.business_id and br.active and br.archived_at is null
        join mediasis.business_role_permissions brp
          on brp.business_role_id = br.business_role_id and brp.revoked_at is null
        join mediasis.business_permissions bp
          on bp.permission_key = brp.permission_key and bp.active and bp.archived_at is null
        where au.app_user_id = p_actor_app_user_id
          and au.status = 'active' and au.deleted_at is null
          and bm.business_id = p_business_id
          and bm.status = 'active' and bm.revoked_at is null
          and bp.permission_key = p_permission_key
      )
    );
$$;

create or replace function mediasis.get_staff_dashboard_authorization_context(
  p_requested_business_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app_user_id uuid := mediasis.current_business_app_user_id();
  v_business_id uuid;
begin
  if not mediasis.is_mediasis_staff_actor(v_app_user_id) then
    return jsonb_build_object('success', false, 'message', 'Not authorized');
  end if;

  select b.uid into v_business_id
  from mediasis.businesses b
  where coalesce(b.active, false)
    and (p_requested_business_id is null or b.uid = p_requested_business_id)
  order by b.full_name, b.uid
  limit 1;

  if v_business_id is null and p_requested_business_id is not null then
    return jsonb_build_object('success', false, 'message', 'Business not found');
  end if;

  return jsonb_build_object(
    'success', true,
    'mode', 'staff',
    'app_user_id', v_app_user_id,
    'active_business_id', v_business_id,
    'all_locations', true,
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_id', b.uid,
        'name', b.full_name,
        'avatar_url', b.avatar_url,
        'clerk_organization_id', b.clerk_organization_id
      ) order by b.full_name, b.uid)
      from mediasis.businesses b where coalesce(b.active, false)
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(bp.permission_key order by bp.permission_key)
      from mediasis.business_permissions bp
      where bp.active and bp.archived_at is null
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_location_id', bl.business_location_id,
        'short_name', bl.short_name,
        'phone_number', bl.phone_number,
        'lat', bl.lat,
        'lng', bl.lng
      ) order by bl.created_at)
      from mediasis.business_location bl where bl.business_uid = v_business_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function mediasis.provision_initial_mediasis_staff(
  p_clerk_user_id text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(pg_catalog.btrim(p_email));
  v_app_user_id uuid;
  v_staff_role_id uuid;
  v_already_active boolean := false;
begin
  if v_email not in ('alejandrog@mediasis.cr', 'ariel.solis@mediasis.cr') then
    raise exception 'Email is not approved for initial staff provisioning';
  end if;
  if nullif(pg_catalog.btrim(p_clerk_user_id), '') is null then
    raise exception 'Clerk user ID is required';
  end if;

  select au.app_user_id into v_app_user_id
  from mediasis.app_users au
  where au.clerk_user_id = pg_catalog.btrim(p_clerk_user_id)
    and lower(au.primary_email) = v_email
    and au.status = 'active' and au.deleted_at is null
  for update;
  if v_app_user_id is null then
    raise exception 'The active Mediasis identity must be synchronized first';
  end if;

  select sr.staff_role_id into v_staff_role_id
  from mediasis.staff_roles sr
  where sr.role_key = 'mediasis_full_access'
    and sr.active and sr.archived_at is null
  limit 1;
  if v_staff_role_id is null then raise exception 'Mediasis full-access role is unavailable'; end if;

  select exists (
    select 1 from mediasis.staff_memberships sm
    where sm.app_user_id = v_app_user_id
      and sm.staff_role_id = v_staff_role_id
      and sm.status = 'active'
      and sm.revoked_at is null
  ) into v_already_active;

  if v_already_active then
    return jsonb_build_object('success', true, 'app_user_id', v_app_user_id, 'changed', false);
  end if;

  insert into mediasis.staff_memberships (app_user_id, staff_role_id, status, revoked_at)
  values (v_app_user_id, v_staff_role_id, 'active', null)
  on conflict (app_user_id) do update
  set staff_role_id = excluded.staff_role_id,
      status = 'active',
      revoked_at = null,
      updated_at = now();

  insert into mediasis.authorization_audit_log (
    actor_app_user_id, subject_app_user_id, action, target_type, target_id,
    after_value, source
  ) values (
    v_app_user_id, v_app_user_id, 'staff.initial_access.granted',
    'staff_membership', v_app_user_id::text,
    jsonb_build_object('role_key', 'mediasis_full_access', 'email', v_email),
    'application'
  );

  return jsonb_build_object('success', true, 'app_user_id', v_app_user_id, 'changed', true);
end;
$$;

revoke all on function mediasis.is_mediasis_staff_actor(uuid) from public, anon, authenticated;
revoke all on function mediasis.is_current_mediasis_staff() from public, anon;
revoke all on function mediasis.get_staff_dashboard_authorization_context(uuid) from public, anon;
revoke all on function mediasis.provision_initial_mediasis_staff(text,text) from public, anon, authenticated;

grant execute on function mediasis.is_mediasis_staff_actor(uuid) to service_role;
grant execute on function mediasis.is_current_mediasis_staff() to authenticated, service_role;
grant execute on function mediasis.get_staff_dashboard_authorization_context(uuid) to authenticated, service_role;
grant execute on function mediasis.provision_initial_mediasis_staff(text,text) to service_role;

commit;
