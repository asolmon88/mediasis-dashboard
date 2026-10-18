-- Migration: 014
-- Read-only verification for migrations 012 and 013.
-- Run each section after the corresponding deployment stage.

-- 1. Column and capability-format constraint installed by 012.
select c.column_name, c.data_type, c.is_nullable
from information_schema.columns c
where c.table_schema = 'mediasis'
  and c.table_name = 'orders'
  and c.column_name = 'guest_checkout_token_hash';

select con.conname,
       pg_catalog.pg_get_constraintdef(con.oid) as definition,
       con.convalidated
from pg_catalog.pg_constraint con
where con.conrelid = 'mediasis.orders'::regclass
  and con.conname = 'orders_guest_checkout_token_hash_format';

select t.tgname,
       t.tgenabled,
       t.tgfoid::regprocedure as trigger_function
from pg_catalog.pg_trigger t
where t.tgrelid = 'mediasis.orders'::regclass
  and t.tgname = 'clear_guest_checkout_capability_on_claim'
  and not t.tgisinternal;

-- 2. Secure commands have empty search paths and SECURITY DEFINER enabled.
select p.oid::regprocedure as function_signature,
       p.prosecdef as security_definer,
       p.proconfig as function_settings
from pg_catalog.pg_proc p
where p.oid in (
  'mediasis.create_checkout_order(uuid,numeric,numeric,numeric,jsonb,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text)'::regprocedure,
  'mediasis.refresh_checkout_order(uuid,uuid,numeric,numeric,numeric,jsonb,uuid,text,numeric,jsonb,uuid,numeric,uuid,text)'::regprocedure
)
order by 1;

-- Expected: false, false, false, true for each command.
select p.oid::regprocedure as function_signature,
       pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') as public_can_execute,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_catalog.pg_proc p
where p.oid in (
  'mediasis.create_checkout_order(uuid,numeric,numeric,numeric,jsonb,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text)'::regprocedure,
  'mediasis.refresh_checkout_order(uuid,uuid,numeric,numeric,numeric,jsonb,uuid,text,numeric,jsonb,uuid,numeric,uuid,text)'::regprocedure
)
order by 1;

-- 3. Existing rows remain valid after the additive stage.
select count(*) as invalid_actor_rows
from mediasis.orders o
where o.deleted_at is null
  and (
    (o.app_user_id is not null and o.guest_checkout_token_hash is not null)
    or (o.guest_checkout_token_hash is not null
        and o.guest_checkout_token_hash !~ '^[0-9a-f]{64}$')
  );

-- 4. Run before 013: the three legacy insert overloads and update function exist.
-- Run after 013: every legacy_*_exists value must be false.
select
  pg_catalog.to_regprocedure('mediasis.insert_order(uuid,numeric,numeric,numeric,jsonb)') is not null
    as legacy_short_insert_exists,
  pg_catalog.to_regprocedure('mediasis.insert_order(uuid,numeric,numeric,numeric,jsonb,uuid,text,numeric,jsonb,text,uuid,numeric)') is not null
    as legacy_authoritative_insert_exists,
  pg_catalog.to_regprocedure('mediasis.insert_order(uuid,text,numeric,numeric,numeric,text,jsonb)') is not null
    as legacy_historical_insert_exists,
  pg_catalog.to_regprocedure('mediasis.update_order_checkout_data(uuid,uuid,numeric,numeric,numeric,jsonb,uuid,text,numeric,jsonb,uuid,numeric)') is not null
    as legacy_update_exists;

-- 5. No ownership pair has both authenticated and guest actors.
select o.order_id, o.app_user_id, o.guest_checkout_token_hash
from mediasis.orders o
where o.app_user_id is not null
  and o.guest_checkout_token_hash is not null;
