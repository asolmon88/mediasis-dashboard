-- Migration: 012
-- Secure guest/authenticated checkout commands.
-- Additive draft: apply before deploying the order-app RPC switch.
-- Broad commerce RLS cleanup is intentionally deferred.

begin;

alter table mediasis.orders
  add column if not exists guest_checkout_token_hash text;

alter table mediasis.orders
  drop constraint if exists orders_guest_checkout_token_hash_format;
alter table mediasis.orders
  add constraint orders_guest_checkout_token_hash_format
  check (
    guest_checkout_token_hash is null
    or guest_checkout_token_hash ~ '^[0-9a-f]{64}$'
  );

comment on column mediasis.orders.guest_checkout_token_hash is
  'HMAC capability for guest checkout continuation. Never contains the raw cart cookie.';

create or replace function mediasis.clear_guest_checkout_capability_on_claim()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.app_user_id is null and new.app_user_id is not null then
    new.guest_checkout_token_hash := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_guest_checkout_capability_on_claim on mediasis.orders;
create trigger clear_guest_checkout_capability_on_claim
before update of app_user_id on mediasis.orders
for each row execute function mediasis.clear_guest_checkout_capability_on_claim();

revoke all on function mediasis.clear_guest_checkout_capability_on_claim()
  from public, anon, authenticated;

create or replace function mediasis.create_checkout_order(
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
  p_hub_delivery_discount_amount numeric default null,
  p_app_user_id uuid default null,
  p_guest_capability_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_human_order_number bigint;
  v_client_phone text;
  v_client_full_name text;
  v_client_first_name text;
  v_client_last_name text;
  v_client_email text;
  v_business_uid uuid;
  v_business_payment_method uuid;
  v_delivery_method uuid;
  v_delivery_method_allowed boolean := false;
  v_payment_method_allowed boolean := false;
  v_drop_lat numeric;
  v_drop_lng numeric;
  v_order_options jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_item_options jsonb;
  v_discount_code_normalized text;
  v_discount_breakdown_safe jsonb;
  v_order_source text;
begin
  begin
    if (p_app_user_id is null) = (p_guest_capability_hash is null) then
      raise exception 'Exactly one checkout actor is required';
    end if;

    if p_app_user_id is not null and not exists (
      select 1
      from mediasis.app_users au
      where au.app_user_id = p_app_user_id
        and au.status = 'active'
        and au.deleted_at is null
    ) then
      raise exception 'Authenticated consumer is not active';
    end if;

    if p_guest_capability_hash is not null
       and p_guest_capability_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid guest checkout capability';
    end if;

    v_discount_code_normalized := case
      when p_discount_code is null or pg_catalog.btrim(p_discount_code) = '' then null
      else pg_catalog.upper(pg_catalog.btrim(p_discount_code))
    end;
    v_discount_breakdown_safe := case
      when p_discount_breakdown is null then null
      when pg_catalog.jsonb_typeof(p_discount_breakdown) in ('array', 'object')
        then p_discount_breakdown
      else null
    end;
    v_order_source := case when p_order_source = 'hub' then 'hub' else 'app' end;

    v_client_phone := p_payload->>'phone';
    v_client_full_name := pg_catalog.btrim(coalesce(p_payload->>'name', ''));
    v_client_first_name := case
      when v_client_full_name = '' then 'Cliente'
      else pg_catalog.split_part(v_client_full_name, ' ', 1)
    end;
    v_client_last_name := case
      when v_client_full_name = '' then 'Mediasis'
      else pg_catalog.substr(
        v_client_full_name,
        pg_catalog.length(pg_catalog.split_part(v_client_full_name, ' ', 1)) + 2
      )
    end;
    v_client_email := coalesce(p_payload->>'email', '');

    if v_client_phone is null or v_client_phone = '' then
      raise exception 'Payload missing phone';
    end if;

    insert into mediasis.client (phone_number, first_name, last_name, email)
    values (v_client_phone, v_client_first_name, v_client_last_name, v_client_email)
    on conflict (phone_number) do update
      set first_name = excluded.first_name,
          last_name = excluded.last_name,
          email = excluded.email;

    v_business_payment_method := nullif(p_payload->>'payment_method_id', '')::uuid;
    v_delivery_method := nullif(p_payload->>'delivery_method', '')::uuid;
    v_drop_lat := nullif(p_payload->'location'->>'lat', '')::numeric;
    v_drop_lng := nullif(p_payload->'location'->>'lng', '')::numeric;
    v_order_options :=
      coalesce(
        case when pg_catalog.jsonb_typeof(p_payload->'options') = 'array'
          then p_payload->'options' else '[]'::jsonb end,
        '[]'::jsonb
      ) ||
      coalesce(
        case when pg_catalog.jsonb_typeof(p_payload->'delivery_method_options') = 'array'
          then p_payload->'delivery_method_options' else '[]'::jsonb end,
        '[]'::jsonb
      );

    select bl.business_uid into v_business_uid
    from mediasis.business_location bl
    join mediasis.businesses b on b.uid = bl.business_uid
    where bl.business_location_id = p_business_location_id
      and coalesce(b.active, false)
    limit 1;

    if v_business_uid is null then raise exception 'Invalid business location'; end if;
    if v_delivery_method is null then raise exception 'Payload missing delivery_method'; end if;

    select exists (
      select 1
      from mediasis.delivery_methods_business dmb
      where dmb.uid = v_delivery_method
        and dmb.business_id = v_business_uid
        and dmb.visibility = true
        and (
          dmb.scope = 'all'::mediasis.scope
          or (
            dmb.scope = 'specific'::mediasis.scope
            and exists (
              select 1 from mediasis.delivery_methods_business_location dmbl
              where dmbl.delivery_methods_business_id = dmb.uid
                and dmbl.business_location_id = p_business_location_id
            )
          )
        )
    ) into v_delivery_method_allowed;
    if not v_delivery_method_allowed then
      raise exception 'Selected delivery method is not available for this business location';
    end if;

    if v_business_payment_method is not null then
      select exists (
        select 1
        from mediasis.business_payment_method bpm
        join mediasis.business_delivery_methods_payment bdmp
          on bdmp.business_payment_method_id = bpm.business_payment_method_id
        where bpm.business_payment_method_id = v_business_payment_method
          and bpm.business_id = v_business_uid
          and bpm.visible = true
          and bdmp.business_delivery_method_id = v_delivery_method
          and (
            bpm.scope = 'all'::mediasis.scope
            or (
              bpm.scope = 'specific'::mediasis.scope
              and exists (
                select 1 from mediasis.business_payment_method_location bpml
                where bpml.business_payment_method_id = bpm.business_payment_method_id
                  and bpml.business_location_id = p_business_location_id
              )
            )
          )
      ) into v_payment_method_allowed;
      if not v_payment_method_allowed then
        raise exception 'Selected payment method is not available for this business location and delivery method';
      end if;
    end if;

    if pg_catalog.jsonb_typeof(p_payload->'products') <> 'array'
       or pg_catalog.jsonb_array_length(p_payload->'products') = 0 then
      raise exception 'No has seleccionado ningún producto';
    end if;

    insert into mediasis.orders (
      amount, client, business_payment_method_id, delivery_method, order_status,
      business_location_id, assigned_rider_id, rider_payment, rejected_by,
      proof_of_delivery_image, signature_image, delivery_note, drop_off,
      delivery_location, drop_off_lat, drop_off_lng, delivery_price,
      products_price, options, discount_id, discount_code, discount_amount,
      discount_breakdown, checkout_payload, checkout_payload_saved_at,
      order_source, hub_discount_applied, hub_delivery_discount_amount,
      app_user_id, guest_checkout_token_hash
    ) values (
      p_amount, v_client_phone, v_business_payment_method, v_delivery_method,
      'pending', p_business_location_id, null, null, '{}'::uuid[], null, null,
      null, null, null, v_drop_lat, v_drop_lng, p_delivery_price,
      p_products_price, v_order_options, p_discount_id,
      v_discount_code_normalized, p_discount_amount, v_discount_breakdown_safe,
      p_payload, pg_catalog.now(), v_order_source, p_hub_discount_id,
      p_hub_delivery_discount_amount, p_app_user_id, p_guest_capability_hash
    ) returning order_id, human_order_number into v_order_id, v_human_order_number;

    for v_item in select value from pg_catalog.jsonb_array_elements(p_payload->'products')
    loop
      v_product_id := nullif(v_item->'product'->>'id', '')::uuid;
      if v_product_id is null then raise exception 'Product item missing product.id'; end if;
      v_qty := coalesce(nullif(v_item->'options'->>'quantity', '')::numeric, 1);
      if v_qty <= 0 then raise exception 'Product quantity must be positive'; end if;
      v_variant_id := nullif(v_item->'options'->>'variant', '')::uuid;

      if v_variant_id is null then
        select pv.product_variant_id into v_variant_id
        from mediasis.product_variant pv
        join mediasis.product p on p.product_id = pv.product_id
        where pv.product_id = v_product_id
          and pv.is_default = true
          and pv.visibility = true
          and p.visibility = true
          and p.business = v_business_uid
        order by pv.created_at asc limit 1;
      end if;

      select pv.price into v_unit_price
      from mediasis.product_variant pv
      join mediasis.product p on p.product_id = pv.product_id
      where pv.product_variant_id = v_variant_id
        and pv.product_id = v_product_id
        and pv.visibility = true
        and p.visibility = true
        and p.business = v_business_uid;
      if v_unit_price is null then raise exception 'Variant is invalid for product'; end if;

      select coalesce(pg_catalog.jsonb_object_agg(k, v), '{}'::jsonb)
      into v_item_options
      from pg_catalog.jsonb_each(
        coalesce(v_item->'options', '{}'::jsonb) - 'quantity' - 'variant'
      ) as e(k, v)
      where not (pg_catalog.jsonb_typeof(v) = 'array' and pg_catalog.jsonb_array_length(v) = 0);

      insert into mediasis.order_item (order_id, pv_id, quantity, unit_price, total_price, options)
      values (v_order_id, v_variant_id, v_qty, v_unit_price, 0, v_item_options);
    end loop;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'data', pg_catalog.jsonb_build_object(
        'order_id', v_order_id,
        'human_order_number', v_human_order_number
      )
    );
  exception when others then
    return pg_catalog.jsonb_build_object('success', false, 'message', sqlerrm);
  end;
end;
$$;

create or replace function mediasis.refresh_checkout_order(
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
  p_hub_delivery_discount_amount numeric default null,
  p_app_user_id uuid default null,
  p_guest_capability_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order mediasis.orders%rowtype;
  v_confirmation_state text;
  v_client_phone text;
  v_client_full_name text;
  v_client_first_name text;
  v_client_last_name text;
  v_client_email text;
  v_business_uid uuid;
  v_business_payment_method uuid;
  v_delivery_method uuid;
  v_delivery_method_allowed boolean := false;
  v_payment_method_allowed boolean := false;
  v_drop_lat numeric;
  v_drop_lng numeric;
  v_order_options jsonb;
  v_item jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_item_options jsonb;
  v_discount_code_normalized text;
  v_discount_breakdown_safe jsonb;
begin
  begin
    if (p_app_user_id is null) = (p_guest_capability_hash is null) then
      raise exception 'Exactly one checkout actor is required';
    end if;

    select o.* into v_order
    from mediasis.orders o
    where o.order_id = p_order_id
      and o.deleted_at is null
    for update;
    if not found then raise exception 'Order not found'; end if;

    if p_app_user_id is not null then
      if v_order.app_user_id is distinct from p_app_user_id or not exists (
        select 1 from mediasis.app_users au
        where au.app_user_id = p_app_user_id
          and au.status = 'active'
          and au.deleted_at is null
      ) then raise exception 'Order does not belong to authenticated consumer'; end if;
    elsif v_order.app_user_id is not null
       or v_order.guest_checkout_token_hash is distinct from p_guest_capability_hash then
      raise exception 'Guest checkout capability does not match order';
    end if;

    if v_order.business_location_id <> p_business_location_id then
      raise exception 'Order business location cannot change';
    end if;
    if v_order.products_payment_status in ('authorized', 'paid', 'refunded', 'cancelled')
       or v_order.order_status in ('delivered', 'cancelled') then
      raise exception 'Finalized orders cannot be refreshed';
    end if;

    select ocs.state into v_confirmation_state
    from mediasis.order_confirmation_state ocs
    where ocs.order_id = p_order_id;
    if v_confirmation_state in ('completed', 'cancelled', 'products_paid', 'sinpe_paid') then
      raise exception 'Order is no longer editable';
    end if;

    v_discount_code_normalized := case
      when p_discount_code is null or pg_catalog.btrim(p_discount_code) = '' then null
      else pg_catalog.upper(pg_catalog.btrim(p_discount_code))
    end;
    v_discount_breakdown_safe := case
      when p_discount_breakdown is null then null
      when pg_catalog.jsonb_typeof(p_discount_breakdown) in ('array', 'object') then p_discount_breakdown
      else null
    end;
    v_client_phone := p_payload->>'phone';
    v_client_full_name := pg_catalog.btrim(coalesce(p_payload->>'name', ''));
    v_client_first_name := case when v_client_full_name = '' then 'Cliente'
      else pg_catalog.split_part(v_client_full_name, ' ', 1) end;
    v_client_last_name := case when v_client_full_name = '' then 'Mediasis'
      else pg_catalog.substr(v_client_full_name, pg_catalog.length(pg_catalog.split_part(v_client_full_name, ' ', 1)) + 2) end;
    v_client_email := coalesce(p_payload->>'email', '');
    if v_client_phone is null or v_client_phone = '' then raise exception 'Payload missing phone'; end if;

    insert into mediasis.client (phone_number, first_name, last_name, email)
    values (v_client_phone, v_client_first_name, v_client_last_name, v_client_email)
    on conflict (phone_number) do update
      set first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email;

    v_business_payment_method := nullif(p_payload->>'payment_method_id', '')::uuid;
    v_delivery_method := nullif(p_payload->>'delivery_method', '')::uuid;
    v_drop_lat := nullif(p_payload->'location'->>'lat', '')::numeric;
    v_drop_lng := nullif(p_payload->'location'->>'lng', '')::numeric;
    v_order_options :=
      coalesce(case when pg_catalog.jsonb_typeof(p_payload->'options') = 'array'
        then p_payload->'options' else '[]'::jsonb end, '[]'::jsonb)
      || coalesce(case when pg_catalog.jsonb_typeof(p_payload->'delivery_method_options') = 'array'
        then p_payload->'delivery_method_options' else '[]'::jsonb end, '[]'::jsonb);

    select bl.business_uid into v_business_uid
    from mediasis.business_location bl
    join mediasis.businesses b on b.uid = bl.business_uid
    where bl.business_location_id = p_business_location_id
      and coalesce(b.active, false);
    if v_business_uid is null or v_delivery_method is null then raise exception 'Invalid checkout selection'; end if;

    select exists (
      select 1 from mediasis.delivery_methods_business dmb
      where dmb.uid = v_delivery_method and dmb.business_id = v_business_uid and dmb.visibility = true
        and (dmb.scope = 'all'::mediasis.scope or (
          dmb.scope = 'specific'::mediasis.scope and exists (
            select 1 from mediasis.delivery_methods_business_location dmbl
            where dmbl.delivery_methods_business_id = dmb.uid
              and dmbl.business_location_id = p_business_location_id
          )
        ))
    ) into v_delivery_method_allowed;
    if not v_delivery_method_allowed then raise exception 'Delivery method is not available'; end if;

    if v_business_payment_method is not null then
      select exists (
        select 1 from mediasis.business_payment_method bpm
        join mediasis.business_delivery_methods_payment bdmp
          on bdmp.business_payment_method_id = bpm.business_payment_method_id
        where bpm.business_payment_method_id = v_business_payment_method
          and bpm.business_id = v_business_uid and bpm.visible = true
          and bdmp.business_delivery_method_id = v_delivery_method
          and (bpm.scope = 'all'::mediasis.scope or (
            bpm.scope = 'specific'::mediasis.scope and exists (
              select 1 from mediasis.business_payment_method_location bpml
              where bpml.business_payment_method_id = bpm.business_payment_method_id
                and bpml.business_location_id = p_business_location_id
            )
          ))
      ) into v_payment_method_allowed;
      if not v_payment_method_allowed then raise exception 'Payment method is not available'; end if;
    end if;

    if pg_catalog.jsonb_typeof(p_payload->'products') <> 'array'
       or pg_catalog.jsonb_array_length(p_payload->'products') = 0 then
      raise exception 'No has seleccionado ningún producto';
    end if;

    update mediasis.orders set
      amount = p_amount, client = v_client_phone,
      business_payment_method_id = v_business_payment_method,
      delivery_method = v_delivery_method, drop_off_lat = v_drop_lat,
      drop_off_lng = v_drop_lng, delivery_price = p_delivery_price,
      products_price = p_products_price, options = v_order_options,
      discount_id = p_discount_id, discount_code = v_discount_code_normalized,
      discount_amount = p_discount_amount, discount_breakdown = v_discount_breakdown_safe,
      hub_discount_applied = p_hub_discount_id,
      hub_delivery_discount_amount = p_hub_delivery_discount_amount,
      checkout_payload = p_payload, checkout_payload_saved_at = pg_catalog.now()
    where order_id = p_order_id;

    delete from mediasis.order_item where order_id = p_order_id;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_payload->'products')
    loop
      v_product_id := nullif(v_item->'product'->>'id', '')::uuid;
      v_qty := coalesce(nullif(v_item->'options'->>'quantity', '')::numeric, 1);
      if v_product_id is null or v_qty <= 0 then raise exception 'Invalid order item'; end if;
      v_variant_id := nullif(v_item->'options'->>'variant', '')::uuid;
      if v_variant_id is null then
        select pv.product_variant_id into v_variant_id
        from mediasis.product_variant pv
        join mediasis.product p on p.product_id = pv.product_id
        where pv.product_id = v_product_id
          and pv.is_default = true
          and pv.visibility = true
          and p.visibility = true
          and p.business = v_business_uid
        order by pv.created_at asc limit 1;
      end if;
      select pv.price into v_unit_price
      from mediasis.product_variant pv
      join mediasis.product p on p.product_id = pv.product_id
      where pv.product_variant_id = v_variant_id
        and pv.product_id = v_product_id
        and pv.visibility = true
        and p.visibility = true
        and p.business = v_business_uid;
      if v_unit_price is null then raise exception 'Variant is invalid for product'; end if;
      select coalesce(pg_catalog.jsonb_object_agg(k, v), '{}'::jsonb)
      into v_item_options
      from pg_catalog.jsonb_each(coalesce(v_item->'options', '{}'::jsonb) - 'quantity' - 'variant') e(k, v)
      where not (pg_catalog.jsonb_typeof(v) = 'array' and pg_catalog.jsonb_array_length(v) = 0);
      insert into mediasis.order_item (order_id, pv_id, quantity, unit_price, total_price, options)
      values (p_order_id, v_variant_id, v_qty, v_unit_price, 0, v_item_options);
    end loop;

    return pg_catalog.jsonb_build_object(
      'success', true,
      'data', pg_catalog.jsonb_build_object('order_id', p_order_id)
    );
  exception when others then
    return pg_catalog.jsonb_build_object('success', false, 'message', sqlerrm);
  end;
end;
$$;

revoke all on function mediasis.create_checkout_order(
  uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric, jsonb,
  text, uuid, numeric, uuid, text
) from public, anon, authenticated;
revoke all on function mediasis.refresh_checkout_order(
  uuid, uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric,
  jsonb, uuid, numeric, uuid, text
) from public, anon, authenticated;
grant execute on function mediasis.create_checkout_order(
  uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric, jsonb,
  text, uuid, numeric, uuid, text
) to service_role;
grant execute on function mediasis.refresh_checkout_order(
  uuid, uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric,
  jsonb, uuid, numeric, uuid, text
) to service_role;

commit;
