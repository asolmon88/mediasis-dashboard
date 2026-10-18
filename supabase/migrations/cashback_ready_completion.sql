-- Migration: 027
-- Treat both ready and delivered as cashback completion statuses.
--
-- The current pharmacy dashboard completes its operational workflow by
-- moving orders to ready. Delivered remains available for the future courier
-- lifecycle, but either transition must release earned cashback and capture
-- redeemed cashback exactly once.
--
-- Apply after 025. Migration 026 may be applied before or after this migration;
-- it does not replace either function below.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'mediasis'
      and t.typname = 'order_status'
      and e.enumlabel = 'ready'
  ) or not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'mediasis'
      and t.typname = 'order_status'
      and e.enumlabel = 'delivered'
  ) then
    raise exception 'mediasis.order_status must contain ready and delivered';
  end if;
end;
$$;

-- The earning function independently validates completion. Updating only the
-- trigger would not work because the migration-024 function rejected ready.
create or replace function mediasis.release_cashback_earning(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashback mediasis.order_cashback%rowtype;
  v_status text;
begin
  select * into v_cashback
  from mediasis.order_cashback
  where order_id = p_order_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('success', true, 'released', false);
  end if;

  select o.order_status::text into v_status
  from mediasis.orders o
  where o.order_id = p_order_id;

  if v_status is null
     or v_status not in ('ready', 'delivered')
     or v_cashback.app_user_id is null
     or v_cashback.earned_minor <= 0
     or v_cashback.earning_status in ('available', 'reversed', 'expired') then
    return pg_catalog.jsonb_build_object('success', true, 'released', false);
  end if;

  insert into mediasis.cashback_events (
    app_user_id, business_uid, order_id, source_earning_order_id,
    event_type, amount_minor, idempotency_key, expires_at, metadata
  ) values (
    v_cashback.app_user_id, v_cashback.business_uid, p_order_id, p_order_id,
    'earning_released', v_cashback.earned_minor,
    'cashback:earning:' || p_order_id::text,
    pg_catalog.now() + interval '1 year',
    pg_catalog.jsonb_build_object('completion_status', v_status)
  ) on conflict (idempotency_key) do nothing;

  update mediasis.order_cashback
     set earning_status = 'available',
         available_at = coalesce(available_at, pg_catalog.now()),
         expires_at = coalesce(expires_at, pg_catalog.now() + interval '1 year'),
         updated_at = pg_catalog.now()
   where order_id = p_order_id;

  return pg_catalog.jsonb_build_object('success', true, 'released', true);
end;
$$;

drop trigger if exists orders_cashback_lifecycle on mediasis.orders;

create or replace function mediasis.cashback_order_lifecycle_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A claimed guest order can already be operationally complete. Attach the
  -- consumer first, then release the earning for either accepted completion
  -- status. Guest orders never contain cashback redemption reservations.
  if new.app_user_id is not null and old.app_user_id is null then
    update mediasis.order_cashback
       set app_user_id = new.app_user_id,
           updated_at = pg_catalog.now()
     where order_id = new.order_id
       and app_user_id is null;

    if new.order_status::text in ('ready', 'delivered') then
      perform mediasis.release_cashback_earning(new.order_id);
    end if;
  end if;

  -- Ready is today's pharmacy completion signal. Delivered is retained for
  -- future courier/rider completion. The called functions and event keys are
  -- idempotent, so ready -> delivered cannot award or capture cashback twice.
  if new.order_status::text in ('ready', 'delivered')
     and old.order_status::text is distinct from new.order_status::text then
    perform mediasis.capture_cashback_redemption(new.order_id);
    perform mediasis.release_cashback_earning(new.order_id);
  elsif new.order_status::text = 'cancelled'
     and old.order_status::text is distinct from new.order_status::text then
    perform mediasis.cancel_order_cashback(new.order_id, 'order_cancelled');
  elsif new.products_payment_status::text = 'refunded'
     and old.products_payment_status::text
         is distinct from new.products_payment_status::text then
    perform mediasis.cancel_order_cashback(new.order_id, 'products_refunded');
  end if;

  return new;
end;
$$;

revoke all on function mediasis.release_cashback_earning(uuid)
  from public, anon, authenticated;
revoke all on function mediasis.cashback_order_lifecycle_trigger()
  from public, anon, authenticated;

create trigger orders_cashback_lifecycle
after update of app_user_id, order_status, products_payment_status
on mediasis.orders
for each row
execute function mediasis.cashback_order_lifecycle_trigger();

-- Existing ready orders will not produce another status transition. Reconcile
-- them once during migration. Both functions are idempotent, making this safe
-- if an order was completed concurrently or the migration is reviewed twice.
do $$
declare
  v_order record;
begin
  for v_order in
    select oc.order_id
    from mediasis.order_cashback oc
    join mediasis.orders o on o.order_id = oc.order_id
    where o.order_status::text = 'ready'
      and (
        oc.earning_status = 'pending'
        or oc.redemption_status = 'reserved'
      )
    for update of oc
  loop
    perform mediasis.capture_cashback_redemption(v_order.order_id);
    perform mediasis.release_cashback_earning(v_order.order_id);
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'mediasis'
      and c.relname = 'orders'
      and t.tgname = 'orders_cashback_lifecycle'
      and not t.tgisinternal
      and t.tgenabled = 'O'
  ) then
    raise exception 'orders_cashback_lifecycle is not enabled';
  end if;
end;
$$;

commit;

-- POST-APPLY READ-ONLY VERIFICATION
-- select o.order_status::text, oc.earning_status, oc.redemption_status,
--        count(*) as records, sum(oc.earned_minor) as earned_minor
-- from mediasis.order_cashback oc
-- join mediasis.orders o on o.order_id = oc.order_id
-- group by o.order_status, oc.earning_status, oc.redemption_status
-- order by o.order_status, oc.earning_status, oc.redemption_status;
--
-- select ce.order_id, ce.amount_minor, ce.idempotency_key,
--        ce.metadata->>'completion_status' as completion_status
-- from mediasis.cashback_events ce
-- where ce.event_type = 'earning_released'
-- order by ce.occurred_at desc limit 25;

-- ROLLBACK NOTE
-- Restoring the 025 delivered-only function and trigger would stop future ready
-- completion. Do not delete or reverse already-posted earning/capture events;
-- they represent orders considered complete under the active business rule.
