-- Compatibility rollback for the application RPC switch.
-- Recreates only the previously authoritative insert/update signatures.
-- The obsolete historical insert_order overloads intentionally remain deleted.

begin;

create or replace function mediasis.insert_order(
  p_business_location_id uuid,
  p_delivery_price numeric,
  p_products_price numeric,
  p_amount numeric,
  p_payload jsonb,
  p_discount_id uuid default null,
  p_discount_code text default null,
  p_discount_amount numeric default null,
  p_discount_breakdown jsonb default null,
  p_order_source text default 'app',
  p_hub_discount_id uuid default null,
  p_hub_delivery_discount_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_capability text :=
    pg_catalog.md5(pg_catalog.gen_random_uuid()::text)
    || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);
begin
  return mediasis.create_checkout_order(
    p_business_location_id,
    p_delivery_price,
    p_products_price,
    p_amount,
    p_payload,
    p_discount_id,
    p_discount_code,
    p_discount_amount,
    p_discount_breakdown,
    p_order_source,
    p_hub_discount_id,
    p_hub_delivery_discount_amount,
    null,
    v_legacy_capability
  );
end;
$$;

create or replace function mediasis.update_order_checkout_data(
  p_order_id uuid,
  p_business_location_id uuid,
  p_delivery_price numeric,
  p_products_price numeric,
  p_amount numeric,
  p_payload jsonb,
  p_discount_id uuid default null,
  p_discount_code text default null,
  p_discount_amount numeric default null,
  p_discount_breakdown jsonb default null,
  p_hub_discount_id uuid default null,
  p_hub_delivery_discount_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_user_id uuid;
  v_guest_capability text;
begin
  select o.app_user_id, o.guest_checkout_token_hash
    into v_app_user_id, v_guest_capability
  from mediasis.orders o
  where o.order_id = p_order_id;

  return mediasis.refresh_checkout_order(
    p_order_id,
    p_business_location_id,
    p_delivery_price,
    p_products_price,
    p_amount,
    p_payload,
    p_discount_id,
    p_discount_code,
    p_discount_amount,
    p_discount_breakdown,
    p_hub_discount_id,
    p_hub_delivery_discount_amount,
    v_app_user_id,
    case when v_app_user_id is null then v_guest_capability else null end
  );
end;
$$;

revoke all on function mediasis.insert_order(
  uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric, jsonb,
  text, uuid, numeric
) from public, anon, authenticated;
revoke all on function mediasis.update_order_checkout_data(
  uuid, uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric,
  jsonb, uuid, numeric
) from public, anon, authenticated;
grant execute on function mediasis.insert_order(
  uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric, jsonb,
  text, uuid, numeric
) to service_role;
grant execute on function mediasis.update_order_checkout_data(
  uuid, uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric,
  jsonb, uuid, numeric
) to service_role;

commit;
