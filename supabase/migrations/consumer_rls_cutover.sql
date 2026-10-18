-- Migration: 010
-- SECURITY CUTOVER — DO NOT APPLY WITH 008/009.
--
-- Apply only after every guest cart, checkout, payment retry, tracking, receipt,
-- and confirmation integration test passes through its restricted server API.
-- This intentionally removes all client policies from sensitive commerce tables.
-- Server operations must use reviewed SECURITY DEFINER functions or a server-only
-- service-role client and must infer ownership from trusted cookie/session state.

begin;

do $$
declare
  table_name text;
  policy_name text;
  protected_tables constant text[] := array[
    'cart',
    'client',
    'orders',
    'order_item',
    'order_confirmation_state',
    'order_status_events'
  ];
begin
  if current_setting('mediasis.consumer_rls_cutover_approved', true) is distinct from 'yes' then
    raise exception
      'Set LOCAL mediasis.consumer_rls_cutover_approved = yes only after checkout integration tests pass';
  end if;

  foreach table_name in array protected_tables loop
    execute format('alter table mediasis.%I enable row level security', table_name);
    for policy_name in
      select pol.polname
      from pg_policy pol
      where pol.polrelid = format('mediasis.%I', table_name)::regclass
    loop
      execute format('drop policy %I on mediasis.%I', policy_name, table_name);
    end loop;

    execute format('revoke all on table mediasis.%I from anon, authenticated', table_name);
  end loop;
end
$$;

-- No direct order/cart mutation policies are added. Authenticated order history
-- is exposed only through the sanitized functions in 009. Guest storefront and
-- tracking access remains available only through the separately audited RPCs.

commit;

-- Required invocation form:
-- begin;
-- set local mediasis.consumer_rls_cutover_approved = 'yes';
-- \i 010_consumer_rls_cutover.sql
-- commit;
