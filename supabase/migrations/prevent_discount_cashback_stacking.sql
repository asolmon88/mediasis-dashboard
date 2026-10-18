-- Migration: 028
-- 028_prevent_discount_cashback_stacking.sql
-- Reviewable draft only. Do not apply automatically.
--
-- Pharmacy cashback and discount codes are mutually exclusive. Any applied
-- discount (including free-delivery and hub discounts) makes the order
-- ineligible to redeem or earn pharmacy-funded cashback.

begin;

do $$
begin
  if pg_catalog.to_regprocedure(
       'mediasis.create_checkout_order_with_cashback(uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text)'
     ) is null then
    raise exception 'Migration 024 is required before migration 028';
  end if;

  if pg_catalog.to_regprocedure(
       'mediasis.refresh_checkout_order_with_cashback(uuid,uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text)'
     ) is null then
    raise exception 'Migration 026 is required before migration 028';
  end if;
end;
$$;

create or replace function mediasis.cashback_discount_present(
  p_discount_id uuid,
  p_discount_code text,
  p_discount_amount numeric,
  p_hub_discount_id uuid,
  p_hub_delivery_discount_amount numeric
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_discount_id is not null
    or nullif(pg_catalog.btrim(p_discount_code), '') is not null
    or coalesce(p_discount_amount, 0) > 0
    or p_hub_discount_id is not null
    or coalesce(p_hub_delivery_discount_amount, 0) > 0;
$$;

create or replace function mediasis.create_checkout_order_with_cashback(
  p_business_location_id uuid,
  p_delivery_price numeric,
  p_products_price numeric,
  p_amount numeric,
  p_payload jsonb,
  p_cashback_eligible_products_minor bigint default 0,
  p_cashback_redemption_minor bigint default 0,
  p_discount_id uuid default null,
  p_discount_code text default null,
  p_discount_amount numeric default null,
  p_discount_breakdown jsonb default null,
  p_order_source text default 'app',
  p_hub_discount_id uuid default null,
  p_hub_delivery_discount_amount numeric default null,
  p_app_user_id uuid default null,
  p_guest_capability_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_business uuid;
  v_setting mediasis.business_cashback_settings%rowtype;
  v_percentage numeric(5,2) := 0;
  v_earned bigint := 0;
  v_has_discount boolean;
begin
  v_has_discount := mediasis.cashback_discount_present(
    p_discount_id,
    p_discount_code,
    p_discount_amount,
    p_hub_discount_id,
    p_hub_delivery_discount_amount
  );

  if p_cashback_eligible_products_minor < 0 or p_cashback_redemption_minor < 0 then
    return pg_catalog.jsonb_build_object(
      'success', false,
      'message', 'Los montos de cashback no son válidos.'
    );
  end if;

  if v_has_discount and p_cashback_redemption_minor > 0 then
    return pg_catalog.jsonb_build_object(
      'success', false,
      'message', 'No podés combinar un código de descuento con cashback.'
    );
  end if;

  if p_cashback_redemption_minor
     > greatest(p_cashback_eligible_products_minor - 100, 0) then
    return pg_catalog.jsonb_build_object(
      'success', false,
      'message', 'El cashback debe dejar al menos ₡1 de productos por pagar.'
    );
  end if;

  if p_cashback_redemption_minor > 0
     and (p_app_user_id is null or p_order_source <> 'app') then
    return pg_catalog.jsonb_build_object(
      'success', false,
      'message', 'El cashback requiere una compra autenticada directamente en la farmacia.'
    );
  end if;

  v_result := mediasis.create_checkout_order(
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
    p_app_user_id,
    p_guest_capability_hash
  );

  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;

  v_order_id := (v_result->'data'->>'order_id')::uuid;

  select bl.business_uid
    into v_business
    from mediasis.business_location bl
   where bl.business_location_id = p_business_location_id;

  select settings.*
    into v_setting
    from mediasis.business_cashback_settings settings
   where settings.business_uid = v_business;

  -- Preserve the configured percentage as the order snapshot even when a
  -- discount excludes this attempt. If the discount is removed in an editable
  -- retry, migration 026's revision flow can use the original percentage.
  if p_order_source = 'app' and coalesce(v_setting.enabled, false) then
    v_percentage := v_setting.percentage;
    if not v_has_discount then
      v_earned := pg_catalog.round(
        (p_cashback_eligible_products_minor - p_cashback_redemption_minor)::numeric
        * v_percentage / 100
      )::bigint;
    end if;
  end if;

  insert into mediasis.order_cashback (
    order_id,
    app_user_id,
    business_uid,
    percentage,
    eligible_products_minor,
    earned_minor,
    redeemed_minor,
    earning_status,
    redemption_status
  ) values (
    v_order_id,
    p_app_user_id,
    v_business,
    v_percentage,
    p_cashback_eligible_products_minor,
    v_earned,
    p_cashback_redemption_minor,
    'pending',
    case when p_cashback_redemption_minor > 0 then 'reserved' else 'none' end
  );

  if p_cashback_redemption_minor > 0 then
    perform mediasis.reserve_business_cashback(
      v_order_id,
      p_app_user_id,
      v_business,
      p_cashback_redemption_minor
    );
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'cashback', pg_catalog.jsonb_build_object(
      'earned_minor', v_earned,
      'redeemed_minor', p_cashback_redemption_minor,
      'percentage', v_percentage
    )
  );
exception when others then
  return pg_catalog.jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

create or replace function mediasis.refresh_checkout_order_with_cashback(
  p_order_id uuid,
  p_business_location_id uuid,
  p_delivery_price numeric,
  p_products_price numeric,
  p_amount numeric,
  p_payload jsonb,
  p_cashback_eligible_products_minor bigint default 0,
  p_cashback_redemption_minor bigint default 0,
  p_discount_id uuid default null,
  p_discount_code text default null,
  p_discount_amount numeric default null,
  p_discount_breakdown jsonb default null,
  p_hub_discount_id uuid default null,
  p_hub_delivery_discount_amount numeric default null,
  p_app_user_id uuid default null,
  p_guest_capability_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order mediasis.orders%rowtype;
  v_cashback mediasis.order_cashback%rowtype;
  v_business_uid uuid;
  v_revision integer;
  v_earned_minor bigint;
  v_has_discount boolean;
begin
  begin
    v_has_discount := mediasis.cashback_discount_present(
      p_discount_id,
      p_discount_code,
      p_discount_amount,
      p_hub_discount_id,
      p_hub_delivery_discount_amount
    );

    if p_cashback_eligible_products_minor < 0 or p_cashback_redemption_minor < 0 then
      raise exception 'Los montos de cashback no son válidos.';
    end if;

    if v_has_discount and p_cashback_redemption_minor > 0 then
      raise exception 'No podés combinar un código de descuento con cashback.';
    end if;

    if p_cashback_redemption_minor
       > greatest(p_cashback_eligible_products_minor - 100, 0) then
      raise exception 'El cashback debe dejar al menos ₡1 de productos por pagar.';
    end if;

    -- The base refresh and all cashback changes remain one subtransaction. A
    -- later allocation failure restores both the previous order and previous
    -- reservation.
    v_result := mediasis.refresh_checkout_order(
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
      p_app_user_id,
      p_guest_capability_hash
    );

    if not coalesce((v_result->>'success')::boolean, false) then
      return v_result;
    end if;

    select orders.*
      into v_order
      from mediasis.orders orders
     where orders.order_id = p_order_id
       for update;

    select cashback.*
      into v_cashback
      from mediasis.order_cashback cashback
     where cashback.order_id = p_order_id
       for update;

    if not found then
      select location.business_uid
        into v_business_uid
        from mediasis.business_location location
       where location.business_location_id = v_order.business_location_id;

      if p_cashback_redemption_minor > 0 then
        raise exception 'El cashback no está disponible para esta orden.';
      end if;

      insert into mediasis.order_cashback (
        order_id,
        app_user_id,
        business_uid,
        percentage,
        eligible_products_minor,
        earned_minor,
        redeemed_minor,
        earning_status,
        redemption_status,
        reservation_revision
      ) values (
        p_order_id,
        v_order.app_user_id,
        v_business_uid,
        0,
        p_cashback_eligible_products_minor,
        0,
        0,
        'pending',
        'none',
        0
      ) returning * into v_cashback;
    end if;

    if v_cashback.redemption_status in ('captured', 'reversed') then
      raise exception 'El cashback de esta orden ya no se puede modificar.';
    end if;

    if p_cashback_redemption_minor > 0 and (
      v_order.order_source is distinct from 'app'
      or v_order.app_user_id is null
      or v_cashback.app_user_id is distinct from v_order.app_user_id
    ) then
      raise exception 'El cashback requiere una compra autenticada directamente en la farmacia.';
    end if;

    -- Switching to a discount releases the current reservation first. The
    -- revision is still incremented, preserving a complete audit trail and
    -- preventing a later retry from restoring an already released allocation.
    if v_cashback.redemption_status = 'reserved' then
      perform mediasis.release_cashback_reservation(p_order_id, 'checkout_retry');
    end if;

    v_revision := v_cashback.reservation_revision + 1;
    v_earned_minor := case
      when v_order.order_source = 'app' and not v_has_discount then
        pg_catalog.round(
          (p_cashback_eligible_products_minor - p_cashback_redemption_minor)::numeric
          * v_cashback.percentage / 100
        )::bigint
      else 0
    end;

    if p_cashback_redemption_minor > 0 then
      perform mediasis.reserve_business_cashback_revision(
        p_order_id,
        v_order.app_user_id,
        v_cashback.business_uid,
        p_cashback_redemption_minor,
        v_revision
      );
    end if;

    update mediasis.order_cashback
       set eligible_products_minor = p_cashback_eligible_products_minor,
           earned_minor = v_earned_minor,
           redeemed_minor = p_cashback_redemption_minor,
           earning_status = 'pending',
           redemption_status = case
             when p_cashback_redemption_minor > 0 then 'reserved'
             else 'none'
           end,
           reservation_revision = v_revision,
           updated_at = pg_catalog.now()
     where order_id = p_order_id;

    return v_result || pg_catalog.jsonb_build_object(
      'cashback', pg_catalog.jsonb_build_object(
        'eligible_products_minor', p_cashback_eligible_products_minor,
        'earned_minor', v_earned_minor,
        'redeemed_minor', p_cashback_redemption_minor,
        'percentage', v_cashback.percentage,
        'reservation_revision', v_revision
      )
    );
  exception when others then
    return pg_catalog.jsonb_build_object('success', false, 'message', sqlerrm);
  end;
end;
$$;

revoke all on function mediasis.cashback_discount_present(uuid,text,numeric,uuid,numeric)
  from public, anon, authenticated;
revoke all on function mediasis.create_checkout_order_with_cashback(
  uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text
) from public, anon, authenticated;
revoke all on function mediasis.refresh_checkout_order_with_cashback(
  uuid,uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text
) from public, anon, authenticated;

grant execute on function mediasis.create_checkout_order_with_cashback(
  uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text
) to service_role;
grant execute on function mediasis.refresh_checkout_order_with_cashback(
  uuid,uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text
) to service_role;

do $$
begin
  if pg_catalog.has_function_privilege(
       'anon',
       'mediasis.create_checkout_order_with_cashback(uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text)',
       'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'authenticated',
       'mediasis.create_checkout_order_with_cashback(uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'An API-facing role can execute the cashback order command';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'mediasis.refresh_checkout_order_with_cashback(uuid,uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text)',
       'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'authenticated',
       'mediasis.refresh_checkout_order_with_cashback(uuid,uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'An API-facing role can execute the cashback retry command';
  end if;
end;
$$;

commit;

-- POST-APPLY READ-ONLY VERIFICATION
--
-- select p.proname, p.prosecdef, p.proconfig, p.proacl
-- from pg_catalog.pg_proc p
-- join pg_catalog.pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'mediasis'
--   and p.proname in (
--     'cashback_discount_present',
--     'create_checkout_order_with_cashback',
--     'refresh_checkout_order_with_cashback'
--   );
--
-- select mediasis.cashback_discount_present(null, null, null, null, null) as no_discount,
--        mediasis.cashback_discount_present(
--          '00000000-0000-0000-0000-000000000001'::uuid,
--          null,
--          null,
--          null,
--          null
--        ) as pharmacy_discount,
--        mediasis.cashback_discount_present(null, ' FREEDELIVERY ', 0, null, 0)
--          as free_delivery_code;
--
-- Existing completed orders are intentionally not modified by this migration.
-- To roll back application behavior, deploy the previous order app first, then
-- restore the function bodies from migrations 024 and 026. Do not drop ledger
-- tables, reservation revisions, or historical cashback events.
