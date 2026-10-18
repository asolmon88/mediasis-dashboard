-- Migration: 070
-- Purpose: Let the trusted Mediasis staff path save Checkout configuration
-- without pretending the staff actor is a pharmacy business member.

begin;

create or replace function mediasis.save_ordering_app_checkout_data(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_location_id uuid,
  p_checkout_data jsonb,
  p_manual_whatsapp boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership mediasis.business_memberships%rowtype;
  v_existing jsonb;
  v_location_ids jsonb;
begin
  perform mediasis.require_ordering_app_storefront_access(
    p_business_id,
    p_actor_app_user_id
  );

  if p_actor_app_user_id is null then
    -- A null actor is accepted only through the service-role-only RPC after
    -- requireStorefrontManagementAccess validated the Mediasis staff session.
    -- Staff have explicit all-business/all-location scope and are not inserted
    -- into every pharmacy's membership table.
    v_membership.all_locations := true;
  else
    select bm.*
    into v_membership
    from mediasis.business_memberships bm
    where bm.business_id = p_business_id
      and bm.app_user_id = p_actor_app_user_id
      and bm.status = 'active'
      and bm.revoked_at is null
    for update;
    if not found then
      raise exception 'Not authorized';
    end if;
  end if;

  if not exists (
    select 1
    from mediasis.business_location bl
    where bl.business_location_id = p_business_location_id
      and bl.business_uid = p_business_id
      and (
        v_membership.all_locations
        or exists (
          select 1
          from mediasis.business_membership_locations bml
          where bml.business_membership_id = v_membership.business_membership_id
            and bml.business_location_id = p_business_location_id
            and bml.revoked_at is null
        )
      )
  ) then
    raise exception 'Not allowed for this business location';
  end if;

  insert into mediasis.business_app_metadata (business_id, checkout_data)
  values (p_business_id, '{}'::jsonb)
  on conflict (business_id) do nothing;

  select coalesce(bam.checkout_data, '{}'::jsonb)
  into v_existing
  from mediasis.business_app_metadata bam
  where bam.business_id = p_business_id
  for update;

  select coalesce(jsonb_agg(distinct value), '[]'::jsonb)
  into v_location_ids
  from (
    select value
    from jsonb_array_elements_text(
      coalesce(
        v_existing->'customer_sends_whatsapp_manually_location_ids',
        '[]'::jsonb
      )
    ) value
    where value <> p_business_location_id::text
    union all
    select p_business_location_id::text
    where coalesce(p_manual_whatsapp, false)
  ) ids;

  update mediasis.business_app_metadata
  set checkout_data = (
    coalesce(p_checkout_data, '{}'::jsonb)
      - 'customer_sends_whatsapp_manually'
      - 'customer_sends_whatsapp_manually_location_ids'
  ) || jsonb_build_object(
    'customer_sends_whatsapp_manually_location_ids',
    v_location_ids
  )
  where business_id = p_business_id;

  return jsonb_build_object('success', true);
exception
  when others then
    return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

revoke all on function mediasis.save_ordering_app_checkout_data(
  uuid, uuid, uuid, jsonb, boolean
) from public, anon, authenticated;
grant execute on function mediasis.save_ordering_app_checkout_data(
  uuid, uuid, uuid, jsonb, boolean
) to service_role;

comment on function mediasis.save_ordering_app_checkout_data(
  uuid, uuid, uuid, jsonb, boolean
) is
  'Saves Checkout settings for an authorized member or the trusted all-location Mediasis staff path.';

commit;
