-- Migration: 036
-- Dual legacy-Supabase and Clerk business authorization foundation.
-- Review only. This migration intentionally does not remove existing mobile policies.

begin;

create or replace function mediasis.current_legacy_business_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject text := nullif(pg_catalog.btrim(auth.jwt() ->> 'sub'), '');
  v_business_id uuid;
begin
  if v_subject is null
    or v_subject !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return null;
  end if;

  v_business_id := v_subject::uuid;
  if exists (
    select 1
    from mediasis.businesses b
    where b.uid = v_business_id
      and coalesce(b.active, false)
  ) then
    return v_business_id;
  end if;

  return null;
end;
$$;

create or replace function mediasis.current_business_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select au.app_user_id
  from mediasis.app_users au
  where au.clerk_user_id = nullif(pg_catalog.btrim(auth.jwt() ->> 'sub'), '')
    and au.status = 'active'
    and au.deleted_at is null
  limit 1;
$$;

create or replace function mediasis.has_business_access(requested_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_business_id is not null
    and (
      mediasis.current_legacy_business_id() = requested_business_id
      or exists (
        select 1
        from mediasis.business_memberships bm
        join mediasis.businesses b on b.uid = bm.business_id
        where bm.business_id = requested_business_id
          and bm.app_user_id = mediasis.current_business_app_user_id()
          and bm.status = 'active'
          and bm.revoked_at is null
          and coalesce(b.active, false)
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
    and (
      mediasis.current_legacy_business_id() = requested_business_id
      or exists (
        select 1
        from mediasis.business_memberships bm
        join mediasis.business_membership_roles bmr
          on bmr.business_membership_id = bm.business_membership_id
         and bmr.business_id = bm.business_id
         and bmr.revoked_at is null
        join mediasis.business_roles br
          on br.business_role_id = bmr.business_role_id
         and br.business_id = bm.business_id
         and br.active
         and br.archived_at is null
        join mediasis.business_role_permissions brp
          on brp.business_role_id = br.business_role_id
         and brp.revoked_at is null
        join mediasis.business_permissions bp
          on bp.permission_key = brp.permission_key
         and bp.active
         and bp.archived_at is null
        join mediasis.businesses b
          on b.uid = bm.business_id
         and coalesce(b.active, false)
        where bm.business_id = requested_business_id
          and bm.app_user_id = mediasis.current_business_app_user_id()
          and bm.status = 'active'
          and bm.revoked_at is null
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
          or exists (
            select 1
            from mediasis.business_memberships bm
            where bm.business_id = bl.business_uid
              and bm.app_user_id = mediasis.current_business_app_user_id()
              and bm.status = 'active'
              and bm.revoked_at is null
              and (
                bm.all_locations
                or exists (
                  select 1
                  from mediasis.business_membership_locations bml
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

insert into mediasis.business_permissions (permission_key, name, description)
values ('analytics.read', 'View analytics', 'View the business analytics dashboard for allowed locations.')
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key)
select br.business_role_id, 'analytics.read'
from mediasis.business_roles br
where br.business_id is not null
  and br.role_key = 'business_full_access'
  and br.active
on conflict (business_role_id, permission_key) do update
set revoked_at = null;

create or replace function mediasis.get_dashboard_authorization_context(
  p_requested_business_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_legacy_business_id uuid := mediasis.current_legacy_business_id();
  v_app_user_id uuid := mediasis.current_business_app_user_id();
  v_business_id uuid;
  v_membership_id uuid;
  v_all_locations boolean := true;
begin
  if v_legacy_business_id is not null then
    v_business_id := v_legacy_business_id;
  elsif v_app_user_id is not null then
    select bm.business_id, bm.business_membership_id, bm.all_locations
    into v_business_id, v_membership_id, v_all_locations
    from mediasis.business_memberships bm
    join mediasis.businesses b on b.uid = bm.business_id
    where bm.app_user_id = v_app_user_id
      and bm.status = 'active'
      and bm.revoked_at is null
      and coalesce(b.active, false)
      and (p_requested_business_id is null or bm.business_id = p_requested_business_id)
    order by bm.created_at
    limit 1;
  end if;

  if v_business_id is null and v_app_user_id is not null then
    return jsonb_build_object(
      'success', true,
      'mode', 'clerk',
      'app_user_id', v_app_user_id,
      'active_business_id', null,
      'all_locations', false,
      'businesses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'business_id', b.uid,
          'name', b.full_name,
          'avatar_url', b.avatar_url,
          'clerk_organization_id', b.clerk_organization_id
        ) order by b.full_name)
        from mediasis.businesses b
        where coalesce(b.active, false)
          and exists (
            select 1 from mediasis.business_memberships bm
            where bm.business_id = b.uid
              and bm.app_user_id = v_app_user_id
              and bm.status = 'active'
              and bm.revoked_at is null
          )
      ), '[]'::jsonb),
      'permissions', '[]'::jsonb,
      'locations', '[]'::jsonb
    );
  elsif v_business_id is null then
    return jsonb_build_object(
      'success', false,
      'mode', case when v_app_user_id is null then 'none' else 'clerk' end,
      'message', 'No tenés acceso a un negocio activo.'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'mode', case when v_legacy_business_id is not null then 'legacy' else 'clerk' end,
    'app_user_id', v_app_user_id,
    'active_business_id', v_business_id,
    'all_locations', v_all_locations,
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_id', available.uid,
        'name', available.full_name,
        'avatar_url', available.avatar_url,
        'clerk_organization_id', available.clerk_organization_id
      ) order by available.full_name)
      from (
        select b.uid, b.full_name, b.avatar_url, b.clerk_organization_id
        from mediasis.businesses b
        where (
          (v_legacy_business_id is not null and b.uid = v_legacy_business_id)
          or (v_legacy_business_id is null and exists (
            select 1
            from mediasis.business_memberships bm
            where bm.business_id = b.uid
              and bm.app_user_id = v_app_user_id
              and bm.status = 'active'
              and bm.revoked_at is null
          ))
        ) and coalesce(b.active, false)
      ) available
    ), '[]'::jsonb),
    'permissions', case
      when v_legacy_business_id is not null then jsonb_build_array('*')
      else coalesce((
        select jsonb_agg(distinct bp.permission_key)
        from mediasis.business_memberships bm
        join mediasis.business_membership_roles bmr
          on bmr.business_membership_id = bm.business_membership_id
         and bmr.business_id = bm.business_id
         and bmr.revoked_at is null
        join mediasis.business_roles br
          on br.business_role_id = bmr.business_role_id
         and br.business_id = bm.business_id
         and br.active
        join mediasis.business_role_permissions brp
          on brp.business_role_id = br.business_role_id
         and brp.revoked_at is null
        join mediasis.business_permissions bp
          on bp.permission_key = brp.permission_key
         and bp.active
        where bm.business_membership_id = v_membership_id
      ), '[]'::jsonb)
    end,
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'business_location_id', bl.business_location_id,
        'short_name', bl.short_name,
        'phone_number', bl.phone_number,
        'lat', bl.lat,
        'lng', bl.lng
      ) order by bl.created_at)
      from mediasis.business_location bl
      where bl.business_uid = v_business_id
        and (
          v_legacy_business_id is not null
          or v_all_locations
          or exists (
            select 1
            from mediasis.business_membership_locations bml
            where bml.business_membership_id = v_membership_id
              and bml.business_location_id = bl.business_location_id
              and bml.revoked_at is null
          )
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function mediasis.current_legacy_business_id() from public, anon;
revoke all on function mediasis.current_business_app_user_id() from public, anon;
revoke all on function mediasis.has_business_access(uuid) from public, anon;
revoke all on function mediasis.has_business_permission(uuid, text) from public, anon;
revoke all on function mediasis.has_location_permission(uuid, text) from public, anon;
revoke all on function mediasis.get_dashboard_authorization_context(uuid) from public, anon;

grant execute on function mediasis.current_legacy_business_id() to authenticated, service_role;
grant execute on function mediasis.current_business_app_user_id() to authenticated, service_role;
grant execute on function mediasis.has_business_access(uuid) to authenticated, service_role;
grant execute on function mediasis.has_business_permission(uuid, text) to authenticated, service_role;
grant execute on function mediasis.has_location_permission(uuid, text) to authenticated, service_role;
grant execute on function mediasis.get_dashboard_authorization_context(uuid) to authenticated, service_role;

-- Compatibility hardening -------------------------------------------------
-- Clerk JWTs also use PostgREST's authenticated role. These replacements keep
-- every existing anonymous storefront allowance intact and preserve the legacy
-- Flutter/dashboard owner's access, while preventing an arbitrary Clerk user
-- from inheriting the old authenticated=true mutation policies.

drop policy if exists "authenticated" on mediasis.business_location;
create policy "legacy business can insert own locations"
on mediasis.business_location for insert to authenticated
with check (business_uid = mediasis.current_legacy_business_id());

drop policy if exists "Authenticated can do all" on mediasis.delivery_methods_business;
create policy "legacy business can manage own delivery methods"
on mediasis.delivery_methods_business for all to authenticated
using (business_id = mediasis.current_legacy_business_id())
with check (business_id = mediasis.current_legacy_business_id());

drop policy if exists "auth can do all" on mediasis.delivery_method_business_pickup_offset_location;
create policy "legacy business can manage own pickup offsets"
on mediasis.delivery_method_business_pickup_offset_location for all to authenticated
using (
  exists (
    select 1 from mediasis.delivery_methods_business dmb
    where dmb.uid = business_delivery_method_id
      and dmb.business_id = mediasis.current_legacy_business_id()
  )
)
with check (
  exists (
    select 1 from mediasis.delivery_methods_business dmb
    where dmb.uid = business_delivery_method_id
      and dmb.business_id = mediasis.current_legacy_business_id()
  )
);

drop policy if exists "Authenticated users can get orders" on mediasis.orders;
-- This reproduces the pre-existing anonymous policy exactly. Removing it is a
-- separate consumer-commerce cutover and is intentionally not bundled into the
-- zero-downtime business authorization pilot.
create policy "anonymous existing order compatibility"
on mediasis.orders for all to anon using (true) with check (true);
create policy "legacy business can manage own orders"
on mediasis.orders for all to authenticated
using (
  exists (
    select 1 from mediasis.business_location bl
    where bl.business_location_id = orders.business_location_id
      and bl.business_uid = mediasis.current_legacy_business_id()
  )
)
with check (
  exists (
    select 1 from mediasis.business_location bl
    where bl.business_location_id = orders.business_location_id
      and bl.business_uid = mediasis.current_legacy_business_id()
  )
);

commit;
