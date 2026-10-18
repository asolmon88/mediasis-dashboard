-- Migration: 045
-- Purpose: Resolve the active Clerk Organization from current compact JWT claims.
-- Apply after migration 044. This file is not applied automatically.

begin;

create or replace function mediasis.current_products_business_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_org_id text;
begin
  v_business_id := mediasis.current_legacy_business_id();
  if v_business_id is not null then return v_business_id; end if;

  -- Current Clerk session tokens use the compact Organization object (`o`).
  -- The other forms remain supported so a Clerk template change does not
  -- silently remove access from otherwise valid memberships.
  v_org_id := coalesce(
    nullif(pg_catalog.btrim(auth.jwt() ->> 'org_id'), ''),
    nullif(pg_catalog.btrim(auth.jwt() #>> '{o,id}'), ''),
    nullif(pg_catalog.btrim(auth.jwt() #>> '{organization,id}'), '')
  );
  if v_org_id is null then return null; end if;

  select b.uid
  into v_business_id
  from mediasis.businesses b
  where b.clerk_organization_id = v_org_id
    and coalesce(b.active, false)
  limit 1;

  if v_business_id is null
     or not mediasis.has_business_permission(v_business_id, 'products.manage.full') then
    return null;
  end if;

  return v_business_id;
exception when others then
  return null;
end;
$$;

revoke all on function mediasis.current_products_business_id() from public, anon;
grant execute on function mediasis.current_products_business_id() to authenticated, service_role;

commit;

-- Verification after applying while signed in through Clerk:
-- select mediasis.current_products_business_id();
