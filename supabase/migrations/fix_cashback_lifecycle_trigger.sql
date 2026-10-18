-- Migration: 025
-- Correct the cashback order lifecycle trigger installed by migration 024.
--
-- Migration 024 compared mediasis.order_status with the nonexistent value
-- "refunded". PostgreSQL attempts to coerce that literal to the enum when the
-- trigger runs, which can reject otherwise unrelated order updates. Refunds
-- belong to mediasis.payment_status and are detected through
-- products_payment_status instead.
--
-- Reviewable draft only. Apply explicitly after migration 024. This migration
-- is safe whether the emergency circuit-breaker already dropped the trigger or
-- the broken trigger still exists.

begin;

-- Fail before changing the trigger unless the production enums contain every
-- value used by the corrected lifecycle function.
do $$
begin
  if to_regtype('mediasis.order_status') is null then
    raise exception 'Required enum mediasis.order_status does not exist';
  end if;

  if to_regtype('mediasis.payment_status') is null then
    raise exception 'Required enum mediasis.payment_status does not exist';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'mediasis'
      and t.typname = 'order_status'
      and e.enumlabel = 'delivered'
  ) or not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'mediasis'
      and t.typname = 'order_status'
      and e.enumlabel = 'cancelled'
  ) then
    raise exception 'mediasis.order_status must contain delivered and cancelled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'mediasis'
      and t.typname = 'payment_status'
      and e.enumlabel = 'refunded'
  ) then
    raise exception 'mediasis.payment_status must contain refunded';
  end if;
end;
$$;

-- Remove either the broken 024 trigger or no-op when the emergency
-- circuit-breaker has already removed it. The corrected function and trigger
-- are installed in this same transaction, so no partially enabled state can
-- commit.
drop trigger if exists orders_cashback_lifecycle on mediasis.orders;

create or replace function mediasis.cashback_order_lifecycle_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Account claims attach the already-created order cashback snapshot to the
  -- newly authenticated consumer. If the order was already delivered, release
  -- its earning now; the release function's idempotency key prevents replay.
  if new.app_user_id is not null and old.app_user_id is null then
    update mediasis.order_cashback
       set app_user_id = new.app_user_id,
           updated_at = now()
     where order_id = new.order_id
       and app_user_id is null;

    if new.order_status::text = 'delivered' then
      perform mediasis.release_cashback_earning(new.order_id);
    end if;
  end if;

  -- Cast enum values to text before comparison. This prevents a misspelled or
  -- nonexistent literal from being coerced to an enum and blocking order
  -- writes, which was the production failure in migration 024.
  if new.order_status::text = 'delivered'
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

-- Trigger functions are invoked by PostgreSQL, never directly by API roles.
revoke all on function mediasis.cashback_order_lifecycle_trigger()
  from public, anon, authenticated;

create trigger orders_cashback_lifecycle
after update of app_user_id, order_status, products_payment_status
on mediasis.orders
for each row
execute function mediasis.cashback_order_lifecycle_trigger();

-- Abort rather than commit if the corrected trigger was not installed and
-- enabled. tgenabled = 'O' means enabled in the normal replication role.
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
    raise exception 'Corrected orders_cashback_lifecycle trigger is not enabled';
  end if;

  if has_function_privilege(
       'anon',
       'mediasis.cashback_order_lifecycle_trigger()',
       'EXECUTE'
     ) or has_function_privilege(
       'authenticated',
       'mediasis.cashback_order_lifecycle_trigger()',
       'EXECUTE'
     ) then
    raise exception 'An API-facing role can execute the cashback trigger function';
  end if;
end;
$$;

commit;

-- POST-APPLY READ-ONLY VERIFICATION
-- Run separately after applying the migration:
--
-- select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as values
-- from pg_catalog.pg_type t
-- join pg_catalog.pg_namespace n on n.oid = t.typnamespace
-- join pg_catalog.pg_enum e on e.enumtypid = t.oid
-- where n.nspname = 'mediasis'
--   and t.typname in ('order_status', 'payment_status')
-- group by t.typname
-- order by t.typname;
--
-- select t.tgname, t.tgenabled, pg_catalog.pg_get_triggerdef(t.oid)
-- from pg_catalog.pg_trigger t
-- join pg_catalog.pg_class c on c.oid = t.tgrelid
-- join pg_catalog.pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'mediasis'
--   and c.relname = 'orders'
--   and t.tgname = 'orders_cashback_lifecycle'
--   and not t.tgisinternal;
--
-- select pg_catalog.pg_get_functiondef(
--   'mediasis.cashback_order_lifecycle_trigger()'::regprocedure
-- );

-- EMERGENCY ROLLBACK / CIRCUIT BREAKER
-- Run separately. This disables cashback lifecycle automation without deleting
-- migration 024 tables, functions, settings, snapshots, or ledger history.
--
-- begin;
-- drop trigger if exists orders_cashback_lifecycle on mediasis.orders;
-- commit;
