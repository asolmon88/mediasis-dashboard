-- Migration: 064
-- Purpose: Restore analytics chart buckets when the legacy aggregate returns
-- summary data without its sales and order time series.

begin;

create or replace function mediasis.get_business_home_timeseries_for_local_dates(
  p_start_local_day date,
  p_end_local_day date,
  p_location_id uuid,
  p_include_all_locations boolean,
  p_bucket text,
  p_requested_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_all_locations boolean := false;
  v_sales jsonb;
  v_orders jsonb;
begin
  if p_start_local_day is null or p_end_local_day is null
    or p_end_local_day < p_start_local_day
  then
    return jsonb_build_object('success', false, 'message', 'El rango de fechas no es válido.');
  end if;

  if p_bucket not in ('day', 'week', 'month') then
    return jsonb_build_object('success', false, 'message', 'La agrupación no es válida.');
  end if;

  if not mediasis.has_business_permission(p_requested_business_id, 'analytics.read') then
    return jsonb_build_object('success', false, 'message', 'No tenés permiso para ver estas analíticas.');
  end if;

  if mediasis.current_legacy_business_id() = p_requested_business_id
    or mediasis.is_current_mediasis_staff()
  then
    v_all_locations := true;
  elsif mediasis.current_legacy_business_id() is null then
    select bm.all_locations
      into v_all_locations
    from mediasis.business_memberships bm
    where bm.business_id = p_requested_business_id
      and bm.app_user_id = mediasis.current_business_app_user_id()
      and bm.status = 'active'
      and bm.revoked_at is null;
  end if;

  if coalesce(p_include_all_locations, false) then
    if not coalesce(v_all_locations, false) then
      return jsonb_build_object('success', false, 'message', 'No tenés acceso a todas las ubicaciones.');
    end if;
  elsif p_location_id is null then
    return jsonb_build_object('success', false, 'message', 'Seleccioná una ubicación permitida.');
  elsif not exists (
    select 1
    from mediasis.business_location bl
    where bl.business_location_id = p_location_id
      and bl.business_uid = p_requested_business_id
  ) or not mediasis.has_location_permission(p_location_id, 'analytics.read') then
    return jsonb_build_object('success', false, 'message', 'No tenés acceso a esta ubicación.');
  end if;

  select bms.timezone
    into v_timezone
  from mediasis.business_market_settings bms
  where bms.business_id = p_requested_business_id;

  if v_timezone is null then
    return jsonb_build_object('success', false, 'message', 'El negocio no tiene configuración regional.');
  end if;

  v_start := p_start_local_day::timestamp at time zone v_timezone;
  v_end := (p_end_local_day + 1)::timestamp at time zone v_timezone;

  with included_orders as (
    select
      date_trunc(p_bucket, o.created_at at time zone v_timezone) as bucket_start,
      coalesce(o.amount, 0)::numeric as amount
    from mediasis.orders o
    join mediasis.business_location bl
      on bl.business_location_id = o.business_location_id
    where bl.business_uid = p_requested_business_id
      and o.created_at >= v_start
      and o.created_at < v_end
      and o.deleted_at is null
      and o.products_payment_status = 'paid'
      and (
        coalesce(p_include_all_locations, false)
        or o.business_location_id = p_location_id
      )
  ), grouped as (
    select bucket_start, sum(amount) as amount, count(*) as order_count
    from included_orders
    group by bucket_start
    order by bucket_start
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'bucket', to_char(bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'amount', amount
    ) order by bucket_start), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'bucket', to_char(bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'count', order_count
    ) order by bucket_start), '[]'::jsonb)
  into v_sales, v_orders
  from grouped;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'sales_over_time', v_sales,
      'orders_over_time', v_orders
    )
  );
end;
$$;

revoke all on function mediasis.get_business_home_timeseries_for_local_dates(
  date, date, uuid, boolean, text, uuid
) from public, anon;
grant execute on function mediasis.get_business_home_timeseries_for_local_dates(
  date, date, uuid, boolean, text, uuid
) to authenticated, service_role;

commit;
