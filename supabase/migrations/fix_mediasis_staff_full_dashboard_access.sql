-- Migration: 065
-- Purpose: Give active Mediasis staff consistent full access to every business
--          dashboard capability while preserving legacy and business RBAC.

begin;

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
      from mediasis.businesses b
      where coalesce(b.active, false)
    ), '[]'::jsonb),
    -- The wildcard is interpreted only by the trusted dashboard application.
    -- Database mutations still validate staff status, business ownership and
    -- resource ownership at their service boundary.
    'permissions', jsonb_build_array('*'),
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
    ), '[]'::jsonb)
  );
end;
$$;

-- This RPC is service-role-only. A null actor is the dashboard server's
-- already-validated full-scope path (legacy owner or Mediasis staff). Ordinary
-- Clerk members always provide their app_user_id and pass exact RBAC checks.
create or replace function mediasis.require_ordering_app_storefront_access(
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
  if p_actor_app_user_id is null then return true; end if;
  if not mediasis.team_actor_has_permission(
    p_business_id,
    p_actor_app_user_id,
    'ordering_app.storefront.manage.full'
  ) then
    raise exception 'Not authorized';
  end if;
  return true;
end;
$$;

revoke all on function mediasis.get_staff_dashboard_authorization_context(uuid)
  from public, anon;
revoke all on function mediasis.require_ordering_app_storefront_access(uuid, uuid)
  from public, anon, authenticated;

grant execute on function mediasis.get_staff_dashboard_authorization_context(uuid)
  to authenticated, service_role;
grant execute on function mediasis.require_ordering_app_storefront_access(uuid, uuid)
  to service_role;

commit;
