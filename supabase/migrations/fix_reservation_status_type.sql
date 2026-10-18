-- Migration: 056
-- Purpose: Remove the invalid hard-coded reservation status enum cast from migration 055.
-- Apply after migration 055. This file is not applied automatically.

begin;

create or replace function mediasis.update_dashboard_reservation(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_reservation_id uuid,
  p_date timestamptz,
  p_size numeric,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location uuid;
  v_result jsonb;
begin
  select r.business_location_id
  into v_location
  from mediasis.reservations r
  where r.id = p_reservation_id
  for update;

  if v_location is null
    or not mediasis.reservation_actor_location_allowed(
      p_business_id,
      p_actor_app_user_id,
      v_location
    )
  then
    raise exception 'Not authorized';
  end if;

  if p_size is null
    or p_size < 1
    or p_size > 100
    or p_status not in ('pending', 'confirmed', 'seated', 'done', 'cancelled')
  then
    raise exception 'Invalid reservation values';
  end if;

  -- jsonb_populate_record delegates conversion to the actual status column
  -- type. This avoids assuming a particular enum type name while retaining
  -- PostgreSQL's native enum/domain validation.
  update mediasis.reservations
  set date = p_date,
      size = p_size,
      status = (
        jsonb_populate_record(
          null::mediasis.reservations,
          jsonb_build_object('status', p_status)
        )
      ).status,
      updated_at = now()
  where id = p_reservation_id;

  select jsonb_build_object(
    'client_email', c.email,
    'location_name', bl.short_name,
    'avatar_url', b.avatar_url
  )
  into v_result
  from mediasis.reservations r
  join mediasis.client c on c.phone_number = r.client
  join mediasis.business_location bl
    on bl.business_location_id = r.business_location_id
  join mediasis.businesses b on b.uid = bl.business_uid
  where r.id = p_reservation_id;

  insert into mediasis.authorization_audit_log (
    actor_app_user_id,
    business_id,
    action,
    target_type,
    target_id,
    after_value
  ) values (
    p_actor_app_user_id,
    p_business_id,
    'reservation.updated',
    'reservation',
    p_reservation_id::text,
    jsonb_build_object('date', p_date, 'size', p_size, 'status', p_status)
  );

  return jsonb_build_object('success', true, 'notification', v_result);
exception
  when others then
    return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

revoke all on function mediasis.update_dashboard_reservation(
  uuid, uuid, uuid, timestamptz, numeric, text
) from public, anon, authenticated;

grant execute on function mediasis.update_dashboard_reservation(
  uuid, uuid, uuid, timestamptz, numeric, text
) to service_role;

commit;
