-- Migration: 009
-- Authenticated consumer profile and sanitized order-history API.
-- Depends on 008 and Clerk third-party JWT configuration in Supabase.

begin;

create or replace function mediasis.update_my_consumer_profile(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := mediasis.current_app_user_id();
  normalized_name text := nullif(btrim(p_display_name), '');
begin
  if current_user_id is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated.');
  end if;
  if normalized_name is null or length(normalized_name) > 120 then
    return jsonb_build_object('success', false, 'message', 'Invalid display name.');
  end if;

  update mediasis.app_users
     set display_name = normalized_name,
         updated_at = now()
   where app_user_id = current_user_id
     and status = 'active';

  return jsonb_build_object('success', found);
end;
$$;

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

alter table mediasis.app_users enable row level security;
alter table mediasis.consumer_profiles enable row level security;

drop policy if exists app_users_consumer_select_own on mediasis.app_users;
create policy app_users_consumer_select_own
on mediasis.app_users for select to authenticated
using (
  app_user_id = mediasis.current_app_user_id()
  and status = 'active'
);

drop policy if exists consumer_profiles_select_own on mediasis.consumer_profiles;
create policy consumer_profiles_select_own
on mediasis.consumer_profiles for select to authenticated
using (
  app_user_id = mediasis.current_app_user_id()
  and deleted_at is null
);

revoke all on function mediasis.update_my_consumer_profile(text) from public;
revoke all on function mediasis.get_my_consumer_orders() from public;
revoke all on function mediasis.get_my_consumer_order(uuid) from public;
grant execute on function mediasis.update_my_consumer_profile(text) to authenticated;
grant execute on function mediasis.get_my_consumer_orders() to authenticated;
grant execute on function mediasis.get_my_consumer_order(uuid) to authenticated;

commit;
