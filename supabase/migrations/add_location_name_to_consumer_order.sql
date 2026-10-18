-- Migration: 018
-- Include the business location's public short name in the authenticated
-- consumer order-detail response.
-- Safe to apply after 009. This replaces one read-only function and does not
-- modify any order or customer data.

begin;

create or replace function mediasis.get_my_consumer_order(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'order_id', o.order_id,
        'human_order_number', o.human_order_number,
        'created_at', o.created_at,
        'order_status', o.order_status,
        'products_price', o.products_price,
        'delivery_price', o.delivery_price,
        'amount', o.amount,
        'discount_code', o.discount_code,
        'discount_amount', o.discount_amount,
        'delivery_method', o.delivery_method,
        'business_name', b.full_name,
        'business_location_name', bl.short_name,
        'business_domain', bd.domain,
        'business_location_id', o.business_location_id
      )
    )
    from mediasis.orders o
    join mediasis.business_location bl
      on bl.business_location_id = o.business_location_id
    join mediasis.businesses b
      on b.uid = bl.business_uid
    left join lateral (
      select candidate.domain
      from mediasis.business_domain candidate
      where candidate.business_uid = b.uid
        and candidate.type = 'order_app'
      order by candidate.created_at desc, candidate.business_domain_id desc
      limit 1
    ) bd on true
    where o.order_id = p_order_id
      and o.app_user_id = mediasis.current_app_user_id()
      and o.deleted_at is null
  ), jsonb_build_object('success', false, 'message', 'Order not found.'));
$$;

revoke all on function mediasis.get_my_consumer_order(uuid)
  from public, anon;
grant execute on function mediasis.get_my_consumer_order(uuid)
  to authenticated;

commit;
