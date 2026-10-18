-- Migration: 032
-- 032_uber_service_fee.sql
-- Reviewable draft only. Do not apply automatically.

begin;

alter table mediasis.orders
  add column if not exists service_fee numeric not null default 0,
  add column if not exists uber_quote_price numeric;

alter table mediasis.orders
  drop constraint if exists orders_service_fee_nonnegative,
  add constraint orders_service_fee_nonnegative check (service_fee >= 0),
  drop constraint if exists orders_uber_quote_price_nonnegative,
  add constraint orders_uber_quote_price_nonnegative
    check (uber_quote_price is null or uber_quote_price >= 0);

alter table mediasis.uber_delivery_quotes
  add column if not exists raw_uber_fee_cents bigint,
  add column if not exists marked_up_fee_cents bigint,
  add column if not exists delivery_fee_cents bigint,
  add column if not exists service_fee_cents bigint,
  add column if not exists customer_fee_cents bigint;

alter table mediasis.uber_delivery_quotes
  drop constraint if exists uber_delivery_quotes_fee_breakdown_nonnegative,
  add constraint uber_delivery_quotes_fee_breakdown_nonnegative check (
    coalesce(raw_uber_fee_cents, 0) >= 0
    and coalesce(marked_up_fee_cents, 0) >= 0
    and coalesce(delivery_fee_cents, 0) >= 0
    and coalesce(service_fee_cents, 0) >= 0
    and coalesce(customer_fee_cents, 0) >= 0
  );

create or replace function mediasis.prevent_uber_quote_breakdown_update_032()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(
    new.raw_uber_fee_cents, new.marked_up_fee_cents, new.delivery_fee_cents,
    new.service_fee_cents, new.customer_fee_cents
  ) is distinct from row(
    old.raw_uber_fee_cents, old.marked_up_fee_cents, old.delivery_fee_cents,
    old.service_fee_cents, old.customer_fee_cents
  ) then
    raise exception 'Uber quote fee breakdown is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists uber_quote_breakdown_immutable_032 on mediasis.uber_delivery_quotes;
create trigger uber_quote_breakdown_immutable_032
before update on mediasis.uber_delivery_quotes
for each row execute function mediasis.prevent_uber_quote_breakdown_update_032();

revoke all on function mediasis.prevent_uber_quote_breakdown_update_032()
  from public, anon, authenticated;

-- New overload used by the order app. The migration-028 overload remains in
-- place during rollout so the previous application can be restored first.
create function mediasis.create_checkout_order_with_cashback(
  p_business_location_id uuid,
  p_delivery_price numeric,
  p_products_price numeric,
  p_amount numeric,
  p_payload jsonb,
  p_service_fee numeric,
  p_uber_quote_price numeric,
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
  v_quote mediasis.uber_delivery_quotes%rowtype;
  v_quote_id text := nullif(p_payload#>>'{uber_context,quote_id}', '');
begin
  if coalesce(p_service_fee, 0) < 0 or coalesce(p_uber_quote_price, 0) < 0 then
    return pg_catalog.jsonb_build_object('success', false, 'message', 'El desglose del envío no es válido.');
  end if;
  if p_uber_quote_price is null and coalesce(p_service_fee, 0) <> 0 then
    return pg_catalog.jsonb_build_object('success', false, 'message', 'El cargo de servicio requiere una cotización válida.');
  end if;

  if p_uber_quote_price is not null then
    select * into v_quote
      from mediasis.uber_delivery_quotes
     where quote_id = v_quote_id
       and business_location_id = p_business_location_id
     for share;
    if not found
       or pg_catalog.lower(pg_catalog.btrim(v_quote.domain))
          <> pg_catalog.lower(pg_catalog.btrim(p_payload#>>'{uber_context,domain}'))
       or v_quote.uber_quote_expires_at is null
       or v_quote.uber_quote_expires_at <= pg_catalog.now()
       or v_quote.manifest_total_value_cents is null
       or v_quote.manifest_total_value_cents <> pg_catalog.round(p_products_price * 100)::bigint
       or v_quote.marked_up_fee_cents is null
       or v_quote.marked_up_fee_cents <> pg_catalog.round(p_uber_quote_price * 100)::bigint
       or v_quote.delivery_fee_cents is null
       or v_quote.service_fee_cents is null
       or not (
         (v_quote.delivery_fee_cents = pg_catalog.round(p_delivery_price * 100)::bigint
          and v_quote.service_fee_cents = pg_catalog.round(p_service_fee * 100)::bigint)
         or
         (v_quote.marked_up_fee_cents = pg_catalog.round(p_delivery_price * 100)::bigint
          and pg_catalog.round(p_service_fee * 100)::bigint in (0, v_quote.service_fee_cents))
       )
    then
      return pg_catalog.jsonb_build_object('success', false, 'message', 'La cotización de entrega no es válida o expiró.');
    end if;
  end if;

  v_result := mediasis.create_checkout_order_with_cashback(
    p_business_location_id, p_delivery_price, p_products_price, p_amount,
    p_payload, p_cashback_eligible_products_minor, p_cashback_redemption_minor,
    p_discount_id, p_discount_code, p_discount_amount, p_discount_breakdown,
    p_order_source, p_hub_discount_id, p_hub_delivery_discount_amount,
    p_app_user_id, p_guest_capability_hash
  );

  if not coalesce((v_result->>'success')::boolean, false) then return v_result; end if;
  v_order_id := (v_result->'data'->>'order_id')::uuid;

  update mediasis.orders
     set service_fee = coalesce(p_service_fee, 0),
         uber_quote_price = p_uber_quote_price
   where order_id = v_order_id;

  return v_result;
exception when others then
  return pg_catalog.jsonb_build_object('success', false, 'message', 'No se pudo crear la orden con el desglose de entrega.');
end;
$$;

create function mediasis.refresh_checkout_order_with_cashback(
  p_order_id uuid,
  p_business_location_id uuid,
  p_delivery_price numeric,
  p_products_price numeric,
  p_amount numeric,
  p_payload jsonb,
  p_service_fee numeric,
  p_uber_quote_price numeric,
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
  v_quote mediasis.uber_delivery_quotes%rowtype;
  v_quote_id text := nullif(p_payload#>>'{uber_context,quote_id}', '');
begin
  if coalesce(p_service_fee, 0) < 0 or coalesce(p_uber_quote_price, 0) < 0 then
    return pg_catalog.jsonb_build_object('success', false, 'message', 'El desglose del envío no es válido.');
  end if;
  if p_uber_quote_price is null and coalesce(p_service_fee, 0) <> 0 then
    return pg_catalog.jsonb_build_object('success', false, 'message', 'El cargo de servicio requiere una cotización válida.');
  end if;

  if p_uber_quote_price is not null then
    select * into v_quote
      from mediasis.uber_delivery_quotes
     where quote_id = v_quote_id
       and business_location_id = p_business_location_id
     for share;
    if not found
       or pg_catalog.lower(pg_catalog.btrim(v_quote.domain))
          <> pg_catalog.lower(pg_catalog.btrim(p_payload#>>'{uber_context,domain}'))
       or v_quote.uber_quote_expires_at is null
       or v_quote.uber_quote_expires_at <= pg_catalog.now()
       or v_quote.manifest_total_value_cents is null
       or v_quote.manifest_total_value_cents <> pg_catalog.round(p_products_price * 100)::bigint
       or v_quote.marked_up_fee_cents is null
       or v_quote.marked_up_fee_cents <> pg_catalog.round(p_uber_quote_price * 100)::bigint
       or v_quote.delivery_fee_cents is null
       or v_quote.service_fee_cents is null
       or not (
         (v_quote.delivery_fee_cents = pg_catalog.round(p_delivery_price * 100)::bigint
          and v_quote.service_fee_cents = pg_catalog.round(p_service_fee * 100)::bigint)
         or
         (v_quote.marked_up_fee_cents = pg_catalog.round(p_delivery_price * 100)::bigint
          and pg_catalog.round(p_service_fee * 100)::bigint in (0, v_quote.service_fee_cents))
       )
    then
      return pg_catalog.jsonb_build_object('success', false, 'message', 'La cotización de entrega no es válida o expiró.');
    end if;
  end if;

  v_result := mediasis.refresh_checkout_order_with_cashback(
    p_order_id, p_business_location_id, p_delivery_price, p_products_price,
    p_amount, p_payload, p_cashback_eligible_products_minor,
    p_cashback_redemption_minor, p_discount_id, p_discount_code,
    p_discount_amount, p_discount_breakdown, p_hub_discount_id,
    p_hub_delivery_discount_amount, p_app_user_id, p_guest_capability_hash
  );

  if not coalesce((v_result->>'success')::boolean, false) then return v_result; end if;

  update mediasis.orders
     set service_fee = coalesce(p_service_fee, 0),
         uber_quote_price = p_uber_quote_price
   where order_id = p_order_id;

  return v_result;
exception when others then
  return pg_catalog.jsonb_build_object('success', false, 'message', 'No se pudo actualizar la orden con el desglose de entrega.');
end;
$$;

revoke all on function mediasis.create_checkout_order_with_cashback(
  uuid,numeric,numeric,numeric,jsonb,numeric,numeric,bigint,bigint,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text
) from public, anon, authenticated;
revoke all on function mediasis.refresh_checkout_order_with_cashback(
  uuid,uuid,numeric,numeric,numeric,jsonb,numeric,numeric,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text
) from public, anon, authenticated;
grant execute on function mediasis.create_checkout_order_with_cashback(
  uuid,numeric,numeric,numeric,jsonb,numeric,numeric,bigint,bigint,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text
) to service_role;
grant execute on function mediasis.refresh_checkout_order_with_cashback(
  uuid,uuid,numeric,numeric,numeric,jsonb,numeric,numeric,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text
) to service_role;

-- Preserve the existing authorization logic by moving the live functions
-- behind wrappers and adding only the two safe monetary fields to their JSON.
alter function mediasis.get_receipt_data(text, uuid)
  rename to get_receipt_data_without_service_fee_032;
alter function mediasis.get_order_tracking_page(text, uuid)
  rename to get_order_tracking_page_without_service_fee_032;

revoke all on function mediasis.get_receipt_data_without_service_fee_032(text,uuid)
  from public, anon, authenticated;
revoke all on function mediasis.get_order_tracking_page_without_service_fee_032(text,uuid)
  from public, anon, authenticated;

create function mediasis.get_receipt_data(p_domain text, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_order mediasis.orders%rowtype;
begin
  v_result := mediasis.get_receipt_data_without_service_fee_032(p_domain, p_order_id);
  if not coalesce((v_result->>'success')::boolean, false) then return v_result; end if;
  select * into v_order from mediasis.orders where order_id = p_order_id;
  return pg_catalog.jsonb_set(
    v_result, '{data,order}',
    (v_result#>'{data,order}') || pg_catalog.jsonb_build_object(
      'service_fee', coalesce(v_order.service_fee, 0),
      'uber_quote_price', v_order.uber_quote_price
    )
  );
end; $$;

create function mediasis.get_order_tracking_page(p_domain text, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_order mediasis.orders%rowtype;
begin
  v_result := mediasis.get_order_tracking_page_without_service_fee_032(p_domain, p_order_id);
  if not coalesce((v_result->>'success')::boolean, false) then return v_result; end if;
  select * into v_order from mediasis.orders where order_id = p_order_id;
  return pg_catalog.jsonb_set(
    v_result, '{data,order}',
    (v_result#>'{data,order}') || pg_catalog.jsonb_build_object(
      'service_fee', coalesce(v_order.service_fee, 0),
      'uber_quote_price', v_order.uber_quote_price
    )
  );
end; $$;

revoke all on function mediasis.get_receipt_data(text,uuid) from public;
revoke all on function mediasis.get_order_tracking_page(text,uuid) from public;
grant execute on function mediasis.get_receipt_data(text,uuid) to anon, authenticated;
grant execute on function mediasis.get_order_tracking_page(text,uuid) to anon, authenticated;

create or replace function mediasis.get_my_consumer_orders(p_domain text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'order_id', o.order_id, 'human_order_number', o.human_order_number,
    'created_at', o.created_at, 'order_status', o.order_status,
    'products_price', o.products_price, 'delivery_price', o.delivery_price,
    'service_fee', coalesce(o.service_fee, 0), 'uber_quote_price', o.uber_quote_price,
    'amount', o.amount, 'business_name', b.full_name,
    'business_logo', nullif(pg_catalog.btrim(bam.appearance_data->>'logo'), ''),
    'business_domain', bd.domain, 'business_location_id', o.business_location_id
  ) order by o.created_at desc), '[]'::jsonb)
  from mediasis.orders o
  join mediasis.business_location bl on bl.business_location_id = o.business_location_id
  join mediasis.businesses b on b.uid = bl.business_uid
  left join mediasis.business_app_metadata bam on bam.business_id = b.uid
  left join lateral (
    select candidate.domain from mediasis.business_domain candidate
    where candidate.business_uid = b.uid and candidate.type = 'order_app'
    order by candidate.created_at desc, candidate.business_domain_id desc limit 1
  ) bd on true
  where o.app_user_id = mediasis.current_app_user_id() and o.deleted_at is null
    and (p_domain is null or exists (
      select 1 from mediasis.business_domain requested_domain
      where requested_domain.business_uid = b.uid and requested_domain.type = 'order_app'
        and requested_domain.consumer_auth_enabled = true
        and mediasis.normalize_consumer_auth_domain(requested_domain.domain)
            = mediasis.normalize_consumer_auth_domain(p_domain)
    ));
$$;

create or replace function mediasis.get_my_consumer_order(p_order_id uuid, p_domain text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select pg_catalog.jsonb_build_object('success', true, 'data',
    pg_catalog.jsonb_build_object(
      'order_id', o.order_id, 'human_order_number', o.human_order_number,
      'created_at', o.created_at, 'order_status', o.order_status,
      'products_price', o.products_price, 'delivery_price', o.delivery_price,
      'service_fee', coalesce(o.service_fee, 0), 'uber_quote_price', o.uber_quote_price,
      'amount', o.amount, 'discount_code', o.discount_code,
      'discount_amount', o.discount_amount, 'delivery_method', o.delivery_method,
      'business_name', b.full_name, 'business_location_name', bl.short_name,
      'business_domain', bd.domain, 'business_location_id', o.business_location_id
    ))
    from mediasis.orders o
    join mediasis.business_location bl on bl.business_location_id = o.business_location_id
    join mediasis.businesses b on b.uid = bl.business_uid
    left join lateral (
      select candidate.domain from mediasis.business_domain candidate
      where candidate.business_uid = b.uid and candidate.type = 'order_app'
      order by candidate.created_at desc, candidate.business_domain_id desc limit 1
    ) bd on true
    where o.order_id = p_order_id and o.app_user_id = mediasis.current_app_user_id()
      and o.deleted_at is null and (p_domain is null or exists (
        select 1 from mediasis.business_domain requested_domain
        where requested_domain.business_uid = b.uid and requested_domain.type = 'order_app'
          and requested_domain.consumer_auth_enabled = true
          and mediasis.normalize_consumer_auth_domain(requested_domain.domain)
              = mediasis.normalize_consumer_auth_domain(p_domain)
      )) limit 1), pg_catalog.jsonb_build_object('success', false, 'message', 'Order not found.'));
$$;

revoke all on function mediasis.get_my_consumer_orders(text) from public;
revoke all on function mediasis.get_my_consumer_order(uuid,text) from public;
grant execute on function mediasis.get_my_consumer_orders(text) to authenticated;
grant execute on function mediasis.get_my_consumer_order(uuid,text) to authenticated;

-- Pharmacy dashboards never receive the private service component. This
-- helper returns only the combined amount paid by the customer and validates
-- every order against the dashboard's current business identity.
create or replace function mediasis.get_my_business_order_delivery_totals(p_order_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'order_id', o.order_id,
    'delivery_total', coalesce(o.delivery_price, 0) + coalesce(o.service_fee, 0)
  )), '[]'::jsonb)
  from mediasis.orders o
  join mediasis.business_location bl on bl.business_location_id = o.business_location_id
  where o.order_id = any(coalesce(p_order_ids, array[]::uuid[]))
    and bl.business_uid = auth.uid();
$$;

revoke all on function mediasis.get_my_business_order_delivery_totals(uuid[])
  from public, anon;
grant execute on function mediasis.get_my_business_order_delivery_totals(uuid[])
  to authenticated;

commit;

-- Verification (read-only after apply):
-- select service_fee, uber_quote_price from mediasis.orders limit 1;
-- select raw_uber_fee_cents, marked_up_fee_cents, delivery_fee_cents,
--        service_fee_cents, customer_fee_cents from mediasis.uber_delivery_quotes limit 1;
-- Rollback order: deploy the previous app, drop the two new RPC overloads,
-- restore the renamed receipt/tracking functions, then retain the additive
-- columns until historical rows no longer depend on them.
