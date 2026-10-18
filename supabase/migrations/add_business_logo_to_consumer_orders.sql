-- Migration: 019
-- Include the optional business logo in the authenticated consumer order list.
-- Logos are read from business_app_metadata.appearance_data ->> 'logo'.
-- Safe to apply after 009. This replaces one read-only function and does not
-- modify any order, business, or customer data.

begin;

create or replace function mediasis.get_my_consumer_orders()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'order_id', o.order_id,
      'human_order_number', o.human_order_number,
      'created_at', o.created_at,
      'order_status', o.order_status,
      'products_price', o.products_price,
      'delivery_price', o.delivery_price,
      'amount', o.amount,
      'business_name', b.full_name,
      'business_logo', nullif(btrim(bam.appearance_data->>'logo'), ''),
      'business_domain', bd.domain,
      'business_location_id', o.business_location_id
    ) order by o.created_at desc
  ), '[]'::jsonb)
  from mediasis.orders o
  join mediasis.business_location bl
    on bl.business_location_id = o.business_location_id
  join mediasis.businesses b
    on b.uid = bl.business_uid
  left join mediasis.business_app_metadata bam
    on bam.business_id = b.uid
  left join lateral (
    select candidate.domain
    from mediasis.business_domain candidate
    where candidate.business_uid = b.uid
      and candidate.type = 'order_app'
    order by candidate.created_at desc, candidate.business_domain_id desc
    limit 1
  ) bd on true
  where o.app_user_id = mediasis.current_app_user_id()
    and o.deleted_at is null;
$$;

revoke all on function mediasis.get_my_consumer_orders()
  from public, anon;
grant execute on function mediasis.get_my_consumer_orders()
  to authenticated;

commit;
