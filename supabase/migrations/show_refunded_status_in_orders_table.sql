-- Migration: 034
-- Preserve the orders page's existing buckets (paid vs. everything else), while
-- exposing refunded payments with their real status for the row badge.

create or replace function mediasis.get_orders_table(
  p_business_location_id uuid,
  p_limit integer default 50,
  p_offset integer default 0,
  p_sort_by text default 'created_at',
  p_sort_direction text default 'desc',
  p_order_status mediasis.order_status[] default null,
  p_payment_status mediasis.payment_status[] default null,
  p_payment_method uuid[] default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns jsonb
language plpgsql
as $function$
declare
  v_business_id uuid;
  v_rows jsonb;
  v_has_more boolean;
begin
  select bl.business_uid
  into v_business_id
  from mediasis.business_location bl
  where bl.business_location_id = p_business_location_id
  limit 1;

  if v_business_id is null or v_business_id <> auth.uid() then
    return jsonb_build_object('success', false, 'message', 'Not allowed for this business location');
  end if;

  with active_uber as (
    select distinct on (ud.order_id) ud.*
    from mediasis.uber_deliveries ud
    where ud.is_active = true
    order by ud.order_id, ud.created_at desc
  ),
  base as (
    select
      o.order_id,
      o.human_order_number,
      o.receipt_url,
      o.created_at,
      greatest(coalesce(o.products_price, 0) - coalesce(o.discount_amount, 0), 0) as total,
      case
        when coalesce(dmb.require_courier, false) = false then coalesce(o.delivery_price, 0)
        else 0
      end as delivery_price,
      o.order_status,
      o.business_payment_method_id,
      o.discount_breakdown,
      c.first_name,
      c.last_name,
      dmb.require_courier,
      dmb.require_location,
      (o.business_payment_method_id is null or pm.name = 'Efectivo') as payment_managed_by_business,
      o.products_payment_status,
      o.products_payment_intent_id,
      o.delivery_payment_status,
      o.delivery_payment_intent_id,
      coalesce(au.tracking_url, o.tracking_link) as tracking_link,
      coalesce(au.uber_delivery_id, o.uber_delivery_id) as uber_delivery_id,
      case
        when o.products_payment_status = 'refunded'::mediasis.payment_status
          then 'refunded'::mediasis.payment_status
        when mediasis.is_order_paid(
          o.order_status,
          o.products_payment_status,
          o.products_payment_intent_id,
          o.delivery_payment_status,
          o.delivery_method,
          o.tracking_link,
          o.uber_delivery_id,
          o.order_id
        ) then 'paid'::mediasis.payment_status
        else 'pending'::mediasis.payment_status
      end as computed_payment_status
    from mediasis.orders o
    join mediasis.client c on c.phone_number = o.client
    left join mediasis.delivery_methods_business dmb on dmb.uid = o.delivery_method
    left join mediasis.business_payment_method bpm
      on bpm.business_payment_method_id = o.business_payment_method_id
    left join mediasis.payment_method pm on pm.uid = bpm.payment_method_id
    left join active_uber au on au.order_id = o.order_id
    where o.business_location_id = p_business_location_id
      and (p_order_status is null or o.order_status = any(p_order_status))
      and (p_payment_method is null or o.business_payment_method_id = any(p_payment_method))
      and (p_date_from is null or o.created_at >= p_date_from)
      and (p_date_to is null or o.created_at <= p_date_to)
  ),
  filtered as (
    select *
    from base
    where p_payment_status is null
      or computed_payment_status = any(p_payment_status)
      -- The existing "Rechazada" tab sends pending and represents every
      -- non-paid order, including successfully refunded payments.
      or (
        'pending'::mediasis.payment_status = any(p_payment_status)
        and computed_payment_status <> 'paid'::mediasis.payment_status
      )
  ),
  sorted as (
    select *
    from filtered
    order by
      case when p_sort_by = 'created_at' and p_sort_direction = 'asc' then created_at end asc nulls last,
      case when p_sort_by = 'created_at' and p_sort_direction = 'desc' then created_at end desc nulls last,
      case when p_sort_by = 'total' and p_sort_direction = 'asc' then total end asc nulls last,
      case when p_sort_by = 'total' and p_sort_direction = 'desc' then total end desc nulls last,
      created_at desc,
      order_id desc
    limit (p_limit + 1)
    offset p_offset
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_id', order_id,
          'human_order_number', human_order_number,
          'receipt_url', receipt_url,
          'created_at', created_at,
          'customer_name', trim(concat(first_name, ' ', last_name)),
          'total', total,
          'delivery_price', delivery_price,
          'order_status', order_status,
          'payment_status', computed_payment_status,
          'delivery_require_courier', coalesce(require_courier, false),
          'delivery_require_location', coalesce(require_location, false),
          'payment_managed_by_business', coalesce(payment_managed_by_business, true)
        )
      ) filter (where rn <= p_limit),
      '[]'::jsonb
    ),
    count(*) > p_limit
  into v_rows, v_has_more
  from (
    select *, row_number() over () as rn
    from sorted
  ) t;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'rows', v_rows,
      'pagination', jsonb_build_object(
        'limit', p_limit,
        'offset', p_offset,
        'has_more', v_has_more
      )
    )
  );
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$function$;
