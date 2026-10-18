-- Migration: 072
-- Purpose: Allow authorized Mediasis staff to grant business location access
--          without requiring a pharmacy membership of their own.

begin;

create or replace function mediasis.team_validate_actor_location_grant(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_all_locations boolean,
  p_location_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_all_locations boolean;
begin
  -- Mediasis staff receive business-wide access from the protected staff model,
  -- not from pharmacy memberships. The caller has already passed the exact
  -- team permission check, and team_validate_location_scope validates that all
  -- submitted locations belong to this business before this function runs.
  if mediasis.is_mediasis_staff_actor(p_actor_app_user_id) then
    return;
  end if;

  select bm.all_locations into v_actor_all_locations
  from mediasis.business_memberships bm
  where bm.business_id = p_business_id
    and bm.app_user_id = p_actor_app_user_id
    and bm.status = 'active'
    and bm.revoked_at is null;

  if not found then
    raise exception 'Active actor membership not found';
  end if;
  if v_actor_all_locations then
    return;
  end if;
  if p_all_locations then
    raise exception 'You cannot grant all-location access';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_location_ids, '{}'::uuid[])) requested(location_id)
    left join mediasis.business_membership_locations bml
      on bml.business_location_id = requested.location_id
     and bml.business_id = p_business_id
     and bml.business_membership_id = (
       select bm.business_membership_id
       from mediasis.business_memberships bm
       where bm.business_id = p_business_id
         and bm.app_user_id = p_actor_app_user_id
         and bm.status = 'active'
         and bm.revoked_at is null
     )
     and bml.revoked_at is null
    where bml.business_location_id is null
  ) then
    raise exception 'You cannot grant a location you do not have';
  end if;
end;
$$;

revoke all on function mediasis.team_validate_actor_location_grant(
  uuid, uuid, boolean, uuid[]
) from public, anon, authenticated, service_role;

commit;
