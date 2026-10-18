-- Migration: 066
-- Purpose: Restore the three default delivery methods and two default payment
--          methods for every newly created business, and attach newly created
--          delivery methods to every existing product in that business.

begin;

create or replace function mediasis.attach_new_delivery_method_to_business_products()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into mediasis.product_delivery_method (
    product_delivery_method_id,
    product_id,
    delivery_method_id
  )
  select pg_catalog.gen_random_uuid(), p.product_id, new.uid
  from mediasis.product p
  where p.business = new.business_id
    and not exists (
      select 1
      from mediasis.product_delivery_method pdm
      where pdm.product_id = p.product_id
        and pdm.delivery_method_id = new.uid
    );

  return new;
end;
$$;

drop trigger if exists delivery_method_attach_to_existing_products
  on mediasis.delivery_methods_business;
create trigger delivery_method_attach_to_existing_products
after insert on mediasis.delivery_methods_business
for each row execute function mediasis.attach_new_delivery_method_to_business_products();

create or replace function mediasis.seed_business_ordering_defaults(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pickup_id uuid;
  v_table_id uuid;
  v_express_id uuid;
  v_card_id uuid;
  v_sinpe_id uuid;
begin
  -- Serialize initial provisioning and retries for the same business so the
  -- idempotent existence checks cannot race and create duplicate defaults.
  perform 1
  from mediasis.businesses b
  where b.uid = p_business_id
  for update;
  if not found then
    raise exception 'Business not found';
  end if;

  -- The global catalog is the source of truth for the default definitions.
  -- Matching by the stable catalog IDs avoids accidentally using a similarly
  -- named custom record.
  select dm.id into v_pickup_id
  from mediasis.delivery_methods dm
  where dm.id = '2048d503-b032-4ee1-aae3-7f20fd90619d'::uuid;
  select dm.id into v_table_id
  from mediasis.delivery_methods dm
  where dm.id = '2c0472e6-726a-4400-860c-57a495a38923'::uuid;
  select dm.id into v_express_id
  from mediasis.delivery_methods dm
  where dm.id = '4c9a21ae-04bc-461f-a09d-94de7ff3ef0f'::uuid;
  select pm.uid into v_card_id
  from mediasis.payment_method pm
  where pm.uid = 'b33258ad-c3c4-4ac0-bf82-954e34bb2c49'::uuid;
  select pm.uid into v_sinpe_id
  from mediasis.payment_method pm
  where pm.uid = 'fd220971-85d0-45d1-879d-8d3f7367547c'::uuid;

  if v_pickup_id is null or v_table_id is null or v_express_id is null
     or v_card_id is null or v_sinpe_id is null then
    raise exception 'Default ordering catalog is incomplete';
  end if;

  insert into mediasis.business_payment_method (
    business_payment_method_id, business_id, payment_method_id, visible, scope
  )
  select pg_catalog.gen_random_uuid(), p_business_id, defaults.payment_method_id, true,
         'all'::mediasis.scope
  from (values (v_card_id), (v_sinpe_id)) defaults(payment_method_id)
  where not exists (
    select 1 from mediasis.business_payment_method bpm
    where bpm.business_id = p_business_id
      and bpm.payment_method_id = defaults.payment_method_id
  );

  insert into mediasis.delivery_methods_business (
    uid, visibility, name, require_location, require_courier,
    delivery_method_id, business_id, scope
  )
  select pg_catalog.gen_random_uuid(), true, defaults.name,
         defaults.require_location, defaults.require_courier,
         defaults.delivery_method_id, p_business_id, 'all'::mediasis.scope
  from (values
    (v_pickup_id, 'Pick up'::text, false, false),
    (v_table_id, 'En mesa'::text, false, false),
    (v_express_id, 'Express'::text, true, true)
  ) defaults(delivery_method_id, name, require_location, require_courier)
  where not exists (
    select 1 from mediasis.delivery_methods_business dmb
    where dmb.business_id = p_business_id
      and dmb.delivery_method_id = defaults.delivery_method_id
  );

  -- Historical defaults allow card on all three methods. SINPE is enabled for
  -- pickup and table service, while Express starts card-only.
  insert into mediasis.business_delivery_methods_payment (
    business_delivery_method_id, business_payment_method_id
  )
  select dmb.uid, bpm.business_payment_method_id
  from mediasis.delivery_methods_business dmb
  join mediasis.business_payment_method bpm on bpm.business_id = dmb.business_id
  where dmb.business_id = p_business_id
    and dmb.delivery_method_id in (v_pickup_id, v_table_id, v_express_id)
    and (
      bpm.payment_method_id = v_card_id
      or (bpm.payment_method_id = v_sinpe_id and dmb.delivery_method_id in (v_pickup_id, v_table_id))
    )
    and not exists (
      select 1 from mediasis.business_delivery_methods_payment bdmp
      where bdmp.business_delivery_method_id = dmb.uid
        and bdmp.business_payment_method_id = bpm.business_payment_method_id
    );
end;
$$;

create or replace function mediasis.seed_new_business_ordering_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform mediasis.seed_business_ordering_defaults(new.uid);
  return new;
end;
$$;

drop trigger if exists business_seed_ordering_defaults on mediasis.businesses;
create trigger business_seed_ordering_defaults
after insert on mediasis.businesses
for each row execute function mediasis.seed_new_business_ordering_defaults();

-- Repair dashboard-provisioned businesses created before this invariant was
-- restored, including retryable failed provisioning rows.
do $$
declare
  v_business_id uuid;
begin
  for v_business_id in
    select distinct bpr.business_id
    from mediasis.business_provisioning_requests bpr
    where bpr.business_id is not null
  loop
    perform mediasis.seed_business_ordering_defaults(v_business_id);
  end loop;
end;
$$;

revoke all on function mediasis.attach_new_delivery_method_to_business_products()
  from public, anon, authenticated, service_role;
revoke all on function mediasis.seed_business_ordering_defaults(uuid)
  from public, anon, authenticated;
revoke all on function mediasis.seed_new_business_ordering_defaults()
  from public, anon, authenticated, service_role;
grant execute on function mediasis.seed_business_ordering_defaults(uuid) to service_role;

commit;
