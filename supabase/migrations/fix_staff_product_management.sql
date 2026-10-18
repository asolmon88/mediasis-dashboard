-- Migration: 064
-- Purpose: Let authorized dashboard server operations manage products for the
--          selected business without requiring a Clerk Organization JWT claim.

begin;

create or replace function mediasis.get_products_for_dashboard(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;
  if not exists (
    select 1 from mediasis.businesses b
    where b.uid = p_business_id and coalesce(b.active, false)
  ) then
    raise exception 'Business not found';
  end if;
  return mediasis.products_call_as_business(p_business_id, 'list');
end;
$$;

create or replace function mediasis.add_product_for_dashboard(
  p_business_id uuid,
  p_product_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  return mediasis.products_call_as_business(p_business_id, 'add', p_product_data);
end;
$$;

create or replace function mediasis.update_product_for_dashboard(
  p_business_id uuid,
  p_diff jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid := nullif(p_diff->'product'->'toUpdate'->>'product_id', '')::uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if v_product_id is null or not exists (
    select 1 from mediasis.product p
    where p.product_id = v_product_id and p.business = p_business_id
  ) then
    raise exception 'Product not found';
  end if;
  return mediasis.products_call_as_business(p_business_id, 'update', p_diff);
end;
$$;

create or replace function mediasis.duplicate_product_for_dashboard(
  p_business_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  if not exists (
    select 1 from mediasis.product p
    where p.product_id = p_product_id and p.business = p_business_id
  ) then
    raise exception 'Product not found';
  end if;
  return mediasis.products_call_as_business(
    p_business_id,
    'duplicate',
    jsonb_build_object('product_id', p_product_id)
  );
end;
$$;

create or replace function mediasis.get_product_option_groups_for_dashboard(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  return mediasis.products_call_as_business(p_business_id, 'groups');
end;
$$;

revoke all on function mediasis.get_products_for_dashboard(uuid) from public, anon, authenticated;
revoke all on function mediasis.add_product_for_dashboard(uuid, jsonb) from public, anon, authenticated;
revoke all on function mediasis.update_product_for_dashboard(uuid, jsonb) from public, anon, authenticated;
revoke all on function mediasis.duplicate_product_for_dashboard(uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.get_product_option_groups_for_dashboard(uuid) from public, anon, authenticated;

grant execute on function mediasis.get_products_for_dashboard(uuid) to service_role;
grant execute on function mediasis.add_product_for_dashboard(uuid, jsonb) to service_role;
grant execute on function mediasis.update_product_for_dashboard(uuid, jsonb) to service_role;
grant execute on function mediasis.duplicate_product_for_dashboard(uuid, uuid) to service_role;
grant execute on function mediasis.get_product_option_groups_for_dashboard(uuid) to service_role;

commit;
