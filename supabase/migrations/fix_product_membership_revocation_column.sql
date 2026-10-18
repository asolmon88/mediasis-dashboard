-- Migration: 047
-- Purpose: Replace invalid business_memberships.deleted_at references with revoked_at.
-- Apply after migration 046. This file is not applied automatically.

begin;

create or replace function mediasis.assert_product_location_payload(p_payload jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_location_text text;
  v_location_id uuid;
begin
  -- Service-role calls originate only from dashboard server actions that have
  -- already validated and merged the caller's visible location scope.
  if auth.role() = 'service_role' then
    return;
  end if;

  if jsonb_path_exists(coalesce(p_payload, '{}'::jsonb), 'lax $.** ? (@.scope == "all")')
    and mediasis.current_legacy_business_id() is null
    and not exists (
      select 1
      from mediasis.business_memberships bm
      where bm.app_user_id = mediasis.current_business_app_user_id()
        and bm.business_id = mediasis.current_products_business_id()
        and bm.all_locations
        and bm.status = 'active'
        and bm.revoked_at is null
    ) then
    raise exception 'All-location access required';
  end if;

  for v_location_text in
    select value #>> '{}'
    from jsonb_path_query(coalesce(p_payload, '{}'::jsonb), 'lax $.**.location_ids[*]') value
    union
    select value->>'value'
    from jsonb_path_query(coalesce(p_payload, '{}'::jsonb), 'lax $.**.business_locations[*]') value
    union
    select value #>> '{}'
    from jsonb_path_query(coalesce(p_payload, '{}'::jsonb), 'lax $.variantLocations.*.toInsert[*]') value
    union
    select value #>> '{}'
    from jsonb_path_query(coalesce(p_payload, '{}'::jsonb), 'lax $.variantLocations.*.toDelete[*]') value
  loop
    if nullif(v_location_text, '') is null then
      continue;
    end if;

    begin
      v_location_id := v_location_text::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Invalid business location';
    end;

    if not mediasis.can_manage_product_location(v_location_id) then
      raise exception 'Not allowed for this business location';
    end if;
  end loop;
end;
$$;

create or replace function mediasis.assert_product_discount_scope(
  p_business_id uuid,
  p_location_scope mediasis.scope,
  p_location_ids uuid[],
  p_product_ids uuid[],
  p_category_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
    and p_business_id <> mediasis.current_products_business_id() then
    raise exception 'Not authorized';
  end if;

  if auth.role() <> 'service_role'
    and p_location_scope = 'all'
    and mediasis.current_legacy_business_id() is null
    and not exists (
      select 1
      from mediasis.business_memberships bm
      where bm.business_id = p_business_id
        and bm.app_user_id = mediasis.current_business_app_user_id()
        and bm.all_locations
        and bm.status = 'active'
        and bm.revoked_at is null
    ) then
    raise exception 'All-location access required';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_location_ids, '{}'::uuid[])) id
    where not exists (
      select 1
      from mediasis.business_location bl
      where bl.business_location_id = id
        and bl.business_uid = p_business_id
    )
      or (
        auth.role() <> 'service_role'
        and not mediasis.can_manage_product_location(id)
      )
  ) then
    raise exception 'Invalid business location';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_product_ids, '{}'::uuid[])) id
    where not exists (
      select 1
      from mediasis.product p
      where p.product_id = id
        and p.business = p_business_id
    )
  ) then
    raise exception 'Invalid product target';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_category_ids, '{}'::uuid[])) id
    where not exists (
      select 1
      from mediasis.product_category pc
      where pc.product_category_id = id
        and pc.business = p_business_id
    )
  ) then
    raise exception 'Invalid category target';
  end if;
end;
$$;

create or replace function mediasis.get_product_for_edit(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := mediasis.current_products_business_id();
begin
  if mediasis.current_legacy_business_id() is not null then
    return mediasis.get_product_for_edit_pre_products_auth(p_product_id);
  end if;

  if auth.role() = 'service_role' then
    select p.business
    into v_business_id
    from mediasis.product p
    where p.product_id = p_product_id;
  end if;

  if v_business_id is null
    or not exists (
      select 1
      from mediasis.product p
      where p.product_id = p_product_id
        and p.business = v_business_id
    ) then
    raise exception 'Product not found';
  end if;

  if auth.role() <> 'service_role'
    and exists (
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

  return mediasis.products_call_as_business(
    v_business_id,
    'edit',
    jsonb_build_object('product_id', p_product_id)
  );
end;
$$;

create or replace function mediasis.add_product(product_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := mediasis.current_products_business_id();
begin
  if v_business_id is null then
    raise exception 'Not authorized';
  end if;

  if mediasis.current_legacy_business_id() is not null then
    return mediasis.add_product_pre_products_auth(product_data);
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(
      coalesce(product_data->'business_locations', '[]'::jsonb)
    )
  )
    and not exists (
      select 1
      from mediasis.business_memberships bm
      where bm.business_id = v_business_id
        and bm.app_user_id = mediasis.current_business_app_user_id()
        and bm.all_locations
        and bm.status = 'active'
        and bm.revoked_at is null
    ) then
    raise exception 'Select at least one permitted location';
  end if;

  perform mediasis.assert_product_location_payload(product_data);

  if exists (
    select 1
    from jsonb_array_elements(
      coalesce(product_data->'categories', '[]'::jsonb)
    ) c
    where not exists (
      select 1
      from mediasis.product_category pc
      where pc.product_category_id = (c->>'value')::uuid
        and pc.business = v_business_id
    )
  ) then
    raise exception 'Invalid product category';
  end if;

  return mediasis.products_call_as_business(v_business_id, 'add', product_data);
end;
$$;

revoke all on function mediasis.assert_product_location_payload(jsonb)
  from public, anon, authenticated;
revoke all on function mediasis.assert_product_discount_scope(uuid, mediasis.scope, uuid[], uuid[], uuid[])
  from public, anon, authenticated;
revoke all on function mediasis.get_product_for_edit(uuid) from public, anon;
revoke all on function mediasis.add_product(jsonb) from public, anon;
grant execute on function mediasis.get_product_for_edit(uuid) to authenticated, service_role;
grant execute on function mediasis.add_product(jsonb) to authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'mediasis.business_memberships'::regclass
      and a.attname = 'deleted_at'
      and not a.attisdropped
  ) then
    raise exception 'Unexpected business_memberships.deleted_at column found; review schema before continuing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'mediasis.business_memberships'::regclass
      and a.attname = 'revoked_at'
      and not a.attisdropped
  ) then
    raise exception 'Required business_memberships.revoked_at column is missing';
  end if;
end;
$$;

commit;

-- Verification (read-only): this must return zero rows.
select p.oid::regprocedure
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'mediasis'
  and p.proname in (
    'assert_product_location_payload',
    'assert_product_discount_scope',
    'get_product_for_edit',
    'add_product'
  )
  and pg_catalog.pg_get_functiondef(p.oid) like '%bm.deleted_at%';
