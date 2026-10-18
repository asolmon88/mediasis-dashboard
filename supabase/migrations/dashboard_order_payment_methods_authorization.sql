-- Migration: 043
-- Complete the Orders authorization slice for the payment-method filter.
--
-- Migration 042 migrated the order RPCs, but the existing Orders filters also
-- call get_visible_payment_methods. Its legacy implementation assigns
-- auth.uid() to a uuid variable, which is incompatible with Clerk subjects such
-- as "user_...". Keep the existing signature and JSON response contract so the
-- legacy dashboard and Flutter app remain compatible.

begin;

create or replace function mediasis.get_visible_payment_methods(
  p_business_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_uid uuid;
  v_payment_methods jsonb;
begin
  select bl.business_uid
  into v_business_uid
  from mediasis.business_location bl
  join mediasis.businesses b on b.uid = bl.business_uid
  where bl.business_location_id = p_business_location_id
    and coalesce(b.active, false)
  limit 1;

  -- has_location_permission is deliberately dual-mode:
  -- * legacy Supabase business owners retain their existing access;
  -- * Clerk members require orders.manage.full and a matching location grant.
  -- It parses the JWT subject safely and never casts a Clerk user_* subject to
  -- uuid. Return the historical response shape instead of revealing whether an
  -- inaccessible location exists.
  if v_business_uid is null
    or not mediasis.has_location_permission(
      p_business_location_id,
      'orders.manage.full'
    )
  then
    return jsonb_build_object(
      'success', false,
      'message', 'Not authorized'
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'uid', bpm.business_payment_method_id,
        'name', pm.name,
        'visibility', bpm.visible
      )
      order by pm.name asc
    ),
    '[]'::jsonb
  )
  into v_payment_methods
  from mediasis.business_payment_method bpm
  join mediasis.payment_method pm on pm.uid = bpm.payment_method_id
  where bpm.business_id = v_business_uid
    and pm.visibility = true
    and (
      bpm.scope = 'all'::mediasis.scope
      or (
        bpm.scope = 'specific'::mediasis.scope
        and exists (
          select 1
          from mediasis.business_payment_method_location bpml
          where bpml.business_payment_method_id = bpm.business_payment_method_id
            and bpml.business_location_id = p_business_location_id
        )
      )
    );

  return jsonb_build_object(
    'success', true,
    'data', v_payment_methods
  );
end;
$$;

revoke all on function mediasis.get_visible_payment_methods(uuid)
from public, anon;

grant execute on function mediasis.get_visible_payment_methods(uuid)
to authenticated, service_role;

commit;

-- Verification (read-only):
--
-- select p.oid::regprocedure::text, p.prosecdef, p.proconfig, p.proacl
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'mediasis'
--   and p.proname = 'get_visible_payment_methods';
--
-- Expected runtime checks:
-- 1. Legacy Supabase owner receives the same payment methods as before.
-- 2. Clerk member with orders.manage.full receives methods only for an allowed location.
-- 3. Clerk member without the permission or location grant receives Not authorized.
-- 4. A Clerk user_* subject never produces an invalid uuid syntax error.

-- Emergency rollback: restore migration 042 behavior by denying the Clerk-only
-- Orders filter rather than restoring the unsafe auth.uid() uuid cast.
-- revoke execute on function mediasis.get_visible_payment_methods(uuid) from authenticated;
