-- Migration: 046
-- Purpose: Restore exact legacy Supabase behavior through product authorization wrappers.
-- Apply after migrations 044 and 045. This file is not applied automatically.

begin;

create or replace function mediasis.get_products_for_table()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_business_id uuid := mediasis.current_products_business_id();
begin
  if v_business_id is null then raise exception 'Not authorized'; end if;
  if mediasis.current_legacy_business_id() is not null then
    return mediasis.get_products_for_table_pre_products_auth();
  end if;
  return mediasis.products_call_as_business(v_business_id, 'list');
end; $$;

create or replace function mediasis.get_product_for_edit(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_business_id uuid := mediasis.current_products_business_id();
begin
  if mediasis.current_legacy_business_id() is not null then
    return mediasis.get_product_for_edit_pre_products_auth(p_product_id);
  end if;
  if auth.role() = 'service_role' then
    select p.business into v_business_id from mediasis.product p where p.product_id = p_product_id;
  end if;
  if v_business_id is null or not exists (
    select 1 from mediasis.product p where p.product_id = p_product_id and p.business = v_business_id
  ) then raise exception 'Product not found'; end if;
  if auth.role() <> 'service_role' and exists (
    select 1
    from mediasis.business_memberships bm
    where bm.business_id = v_business_id
      and bm.app_user_id = mediasis.current_business_app_user_id()
      and bm.status = 'active'
      and bm.revoked_at is null
      and not bm.all_locations
  ) then
    raise exception 'Product details require an authorized server operation';
  end if;
  return mediasis.products_call_as_business(v_business_id, 'edit', jsonb_build_object('product_id', p_product_id));
end; $$;

create or replace function mediasis.add_product(product_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_business_id uuid := mediasis.current_products_business_id();
begin
  if v_business_id is null then raise exception 'Not authorized'; end if;
  if mediasis.current_legacy_business_id() is not null then
    return mediasis.add_product_pre_products_auth(product_data);
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(product_data->'business_locations', '[]'::jsonb))
  ) and not exists (
    select 1 from mediasis.business_memberships bm
    where bm.business_id = v_business_id
      and bm.app_user_id = mediasis.current_business_app_user_id()
      and bm.all_locations and bm.status = 'active' and bm.revoked_at is null
  ) then
    raise exception 'Select at least one permitted location';
  end if;
  perform mediasis.assert_product_location_payload(product_data);
  if exists (
    select 1 from jsonb_array_elements(coalesce(product_data->'categories','[]'::jsonb)) c
    where not exists (
      select 1 from mediasis.product_category pc
      where pc.product_category_id=(c->>'value')::uuid and pc.business=v_business_id
    )
  ) then raise exception 'Invalid product category'; end if;
  return mediasis.products_call_as_business(v_business_id, 'add', product_data);
end; $$;

create or replace function mediasis.update_product_from_diff(diff jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_business_id uuid := mediasis.current_products_business_id();
  v_product_id uuid := (diff->'product'->'toUpdate'->>'product_id')::uuid;
begin
  if mediasis.current_legacy_business_id() is not null then
    return mediasis.update_product_from_diff_pre_products_auth(diff);
  end if;
  if auth.role() = 'service_role' then
    select p.business into v_business_id from mediasis.product p where p.product_id = v_product_id;
  end if;
  if v_business_id is null or not exists (
    select 1 from mediasis.product p where p.product_id=v_product_id and p.business=v_business_id
  ) then raise exception 'Product not found'; end if;
  perform mediasis.assert_product_location_payload(diff);
  return mediasis.products_call_as_business(v_business_id, 'update', diff);
end; $$;

create or replace function mediasis.duplicate_product(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_business_id uuid := mediasis.current_products_business_id();
begin
  if mediasis.current_legacy_business_id() is not null then
    return mediasis.duplicate_product_pre_products_auth(p_product_id);
  end if;
  if v_business_id is null or not exists (
    select 1 from mediasis.product p where p.product_id=p_product_id and p.business=v_business_id
  ) then raise exception 'Product not found'; end if;
  return mediasis.products_call_as_business(v_business_id, 'duplicate', jsonb_build_object('product_id', p_product_id));
end; $$;

create or replace function mediasis.get_business_option_groups(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_business_id uuid := mediasis.current_products_business_id();
begin
  if mediasis.current_legacy_business_id() is not null then
    return mediasis.get_business_option_groups_pre_products_auth(p_business_id);
  end if;
  if auth.role() = 'service_role' then v_business_id := p_business_id; end if;
  if v_business_id is null or p_business_id <> v_business_id then raise exception 'Not authorized'; end if;
  return mediasis.products_call_as_business(v_business_id, 'groups');
end; $$;

revoke all on function mediasis.get_products_for_table() from public, anon;
revoke all on function mediasis.get_product_for_edit(uuid) from public, anon;
revoke all on function mediasis.add_product(jsonb) from public, anon;
revoke all on function mediasis.update_product_from_diff(jsonb) from public, anon;
revoke all on function mediasis.duplicate_product(uuid) from public, anon;
revoke all on function mediasis.get_business_option_groups(uuid) from public, anon;
grant execute on function mediasis.get_products_for_table() to authenticated, service_role;
grant execute on function mediasis.get_product_for_edit(uuid) to authenticated, service_role;
grant execute on function mediasis.add_product(jsonb) to authenticated, service_role;
grant execute on function mediasis.update_product_from_diff(jsonb) to authenticated, service_role;
grant execute on function mediasis.duplicate_product(uuid) to authenticated, service_role;
grant execute on function mediasis.get_business_option_groups(uuid) to authenticated, service_role;

commit;
