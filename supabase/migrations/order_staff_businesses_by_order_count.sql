-- Migration: 069
-- Purpose: Rank Mediasis staff's business selector by historical order count so
-- active businesses appear before businesses without sales activity.

begin;

create index if not exists orders_business_location_id_idx
  on mediasis.orders (business_location_id);

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

  select ranked.business_id
  into v_business_id
  from (
    select
      b.uid as business_id,
      b.full_name,
      count(o.order_id) as order_count
    from mediasis.businesses b
    left join mediasis.business_location bl
      on bl.business_uid = b.uid
    left join mediasis.orders o
      on o.business_location_id = bl.business_location_id
    where coalesce(b.active, false)
      and (p_requested_business_id is null or b.uid = p_requested_business_id)
    group by b.uid, b.full_name
  ) ranked
  order by ranked.order_count desc, ranked.full_name, ranked.business_id
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
      select jsonb_agg(
        jsonb_build_object(
          'business_id', ranked.business_id,
          'name', ranked.name,
          'avatar_url', ranked.avatar_url,
          'clerk_organization_id', ranked.clerk_organization_id,
          'order_count', ranked.order_count
        )
        order by ranked.order_count desc, ranked.name, ranked.business_id
      )
      from (
        select
          b.uid as business_id,
          b.full_name as name,
          b.avatar_url,
          b.clerk_organization_id,
          count(o.order_id) as order_count
        from mediasis.businesses b
        left join mediasis.business_location bl
          on bl.business_uid = b.uid
        left join mediasis.orders o
          on o.business_location_id = bl.business_location_id
        where coalesce(b.active, false)
        group by b.uid, b.full_name, b.avatar_url, b.clerk_organization_id
      ) ranked
    ), '[]'::jsonb),
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

revoke all on function mediasis.get_staff_dashboard_authorization_context(uuid)
  from public, anon;
grant execute on function mediasis.get_staff_dashboard_authorization_context(uuid)
  to authenticated, service_role;

comment on function mediasis.get_staff_dashboard_authorization_context(uuid) is
  'Returns the selected staff business plus all active businesses ranked by historical order count.';

commit;
