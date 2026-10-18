-- Migration: 011
-- Read-only verification for migrations 008-010.

-- Ownership columns and FK delete/update behavior.
select
  conrelid::regclass as source_table,
  conname,
  confupdtype as update_action,
  confdeltype as delete_action
from pg_constraint
where conname in ('client_app_user_fk', 'cart_app_user_fk', 'orders_app_user_fk')
order by conname;
-- Expected: update_action = c (CASCADE), delete_action = r (RESTRICT).

-- No account identity may own multiple legacy client records.
select app_user_id, count(*)
from mediasis.client
where app_user_id is not null
group by app_user_id
having count(*) > 1;

-- No consumed claim can be missing its consuming user or timestamp.
select consumer_account_claim_id
from mediasis.consumer_account_claims
where (consumed_at is null) <> (consumed_by_app_user_id is null);

-- No order may point at an inactive/deleted consumer.
select o.order_id, au.status
from mediasis.orders o
join mediasis.app_users au on au.app_user_id = o.app_user_id
where au.status <> 'active';

-- Sensitive policies remaining before/after cutover.
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'mediasis'
  and tablename in (
    'cart', 'client', 'orders', 'order_item',
    'order_confirmation_state', 'order_status_events'
  )
order by tablename, policyname;

-- Function security and fixed search paths.
select
  n.nspname,
  p.proname,
  p.prosecdef,
  p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'mediasis'
  and p.proname in (
    'create_consumer_account_claim',
    'consume_consumer_account_claim',
    'update_my_consumer_profile',
    'get_my_consumer_orders',
    'get_my_consumer_order'
  )
order by p.proname;
