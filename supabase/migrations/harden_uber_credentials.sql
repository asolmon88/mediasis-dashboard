-- Migration: 020
-- Harden Uber operational credentials and token storage.
--
-- IMPORTANT DEPLOYMENT ORDER
-- 1. Deploy the order app version that uses createAdminClient() for all four
--    Uber RPCs before applying this migration.
-- 2. Adapt and deploy the dashboard Uber operations to use a service-role
--    server client before applying this migration. The dashboard currently
--    reads mediasis.uber_keys and mediasis.uber_auth_credential with a business
--    session; those reads will intentionally stop working after this cutover.
-- 3. Keep SUPABASE_SERVICE_ROLE_KEY server-only. Never expose it through a
--    NEXT_PUBLIC variable or send it to a browser.
--
-- This migration does not alter or delete credential rows. It removes public
-- access paths and grants the minimum required table/function privileges to
-- service_role. It is intentionally not applied automatically.

begin;

-- Fail closed if the expected objects differ from the reviewed production
-- schema. This prevents a partial security cutover against unknown objects.
do $$
declare
  required_function text;
begin
  if to_regclass('mediasis.uber_auth_credential') is null then
    raise exception 'Required table mediasis.uber_auth_credential is missing';
  end if;
  if to_regclass('mediasis.uber_keys') is null then
    raise exception 'Required table mediasis.uber_keys is missing';
  end if;

  foreach required_function in array array[
    'mediasis.get_uber_token_encrypted(text)',
    'mediasis.get_uber_client_credentials(text)',
    'mediasis.upsert_uber_token(text,text,timestamp with time zone)',
    'mediasis.get_uber_customer_id(text)'
  ] loop
    if to_regprocedure(required_function) is null then
      raise exception 'Required function % is missing', required_function;
    end if;
  end loop;
end;
$$;

alter table mediasis.uber_auth_credential enable row level security;
alter table mediasis.uber_keys enable row level security;

-- These legacy policies exposed all matching rows and are no longer needed.
drop policy if exists "anon can insert" on mediasis.uber_auth_credential;
drop policy if exists "anon can select" on mediasis.uber_auth_credential;
drop policy if exists "anon can update" on mediasis.uber_auth_credential;
drop policy if exists "anon & authenticated can select" on mediasis.uber_keys;

-- Remove direct table access from API-facing roles. service_role receives the
-- operations required by both reviewed server-only workflows:
--   * order app: read keys and read/upsert encrypted tokens;
--   * Mediasis owners dashboard: manage keys and invalidate cached credentials
--     by deleting the corresponding uber_auth_credential row.
revoke all privileges on table mediasis.uber_auth_credential
  from public, anon, authenticated, service_role;
revoke all privileges on table mediasis.uber_keys
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table mediasis.uber_auth_credential
  to service_role;
grant select, insert, update, delete on table mediasis.uber_keys
  to service_role;

-- Keep these functions as SECURITY INVOKER. The service role already bypasses
-- RLS; using SECURITY DEFINER would create an unnecessary privilege-escalation
-- surface. A fixed empty search_path prevents object-shadowing attacks.
alter function mediasis.get_uber_token_encrypted(text)
  security invoker
  set search_path = '';
alter function mediasis.get_uber_client_credentials(text)
  security invoker
  set search_path = '';
alter function mediasis.upsert_uber_token(text, text, timestamp with time zone)
  security invoker
  set search_path = '';
alter function mediasis.get_uber_customer_id(text)
  security invoker
  set search_path = '';

revoke all privileges on function mediasis.get_uber_token_encrypted(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function mediasis.get_uber_client_credentials(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function mediasis.upsert_uber_token(text, text, timestamp with time zone)
  from public, anon, authenticated, service_role;
revoke all privileges on function mediasis.get_uber_customer_id(text)
  from public, anon, authenticated, service_role;

grant execute on function mediasis.get_uber_token_encrypted(text)
  to service_role;
grant execute on function mediasis.get_uber_client_credentials(text)
  to service_role;
grant execute on function mediasis.upsert_uber_token(text, text, timestamp with time zone)
  to service_role;
grant execute on function mediasis.get_uber_customer_id(text)
  to service_role;

-- Assertions make the migration abort rather than commit an incomplete
-- cutover. service_role is expected to bypass RLS in Supabase.
do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'mediasis'
      and tablename in ('uber_auth_credential', 'uber_keys')
      and (roles && array['public', 'anon', 'authenticated']::name[])
  ) then
    raise exception 'An API-facing Uber credential RLS policy still exists';
  end if;

  if has_table_privilege('anon', 'mediasis.uber_auth_credential', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'mediasis.uber_auth_credential', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'mediasis.uber_keys', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'mediasis.uber_keys', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'An API-facing role still has direct Uber credential table privileges';
  end if;

  if has_function_privilege('anon', 'mediasis.get_uber_token_encrypted(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'mediasis.get_uber_token_encrypted(text)', 'EXECUTE')
     or has_function_privilege('anon', 'mediasis.get_uber_client_credentials(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'mediasis.get_uber_client_credentials(text)', 'EXECUTE')
     or has_function_privilege('anon', 'mediasis.upsert_uber_token(text,text,timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('authenticated', 'mediasis.upsert_uber_token(text,text,timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('anon', 'mediasis.get_uber_customer_id(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'mediasis.get_uber_customer_id(text)', 'EXECUTE') then
    raise exception 'An API-facing role can still execute a protected Uber function';
  end if;
end;
$$;

commit;

-- POST-APPLY READ-ONLY VERIFICATION
-- Run separately after deployment and migration review:
--
-- select schemaname, tablename, policyname, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'mediasis'
--   and tablename in ('uber_auth_credential', 'uber_keys');
--
-- select p.proname, p.prosecdef, p.proconfig, p.proacl
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'mediasis'
--   and p.proname in (
--     'get_uber_token_encrypted',
--     'get_uber_client_credentials',
--     'upsert_uber_token',
--     'get_uber_customer_id'
--   );
