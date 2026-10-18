-- Migration: 044
-- Purpose: Add full product-management authorization with location-scoped availability.
-- Review and apply after migration 043. This file is not applied automatically.

begin;

insert into mediasis.business_permissions (permission_key, name, description)
values (
  'products.manage.full',
  'Administrar todos los productos',
  'Administrar el catálogo completo del negocio y la disponibilidad en las ubicaciones permitidas.'
)
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

update mediasis.business_permissions
set active = false,
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
where permission_key in ('products.read', 'products.manage');

insert into mediasis.business_role_permissions (business_role_id, permission_key)
select br.business_role_id, 'products.manage.full'
from mediasis.business_roles br
where br.role_key = 'business_full_access'
  and br.role_origin = 'system'
  and br.business_id is not null
  and br.active
  and br.archived_at is null
on conflict (business_role_id, permission_key) do update set revoked_at = null;

create or replace function mediasis.get_business_products_permission_catalog(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role_permissions jsonb;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.read');
  select coalesce(jsonb_object_agg(br.business_role_id::text, coalesce(keys.permission_keys, '[]'::jsonb)), '{}'::jsonb)
  into v_role_permissions
  from mediasis.business_roles br
  left join lateral (
    select jsonb_agg(brp.permission_key order by brp.permission_key) permission_keys
    from mediasis.business_role_permissions brp
    where brp.business_role_id = br.business_role_id
      and brp.permission_key = 'products.manage.full'
      and brp.revoked_at is null
  ) keys on true
  where br.business_id = p_business_id and br.active and br.archived_at is null;

  return jsonb_build_object(
    'success', true,
    'permissions', jsonb_build_array(jsonb_build_object(
      'key', 'products.manage.full',
      'name', 'Administrar todos los productos',
      'description', 'Administrar productos, categorías, descuentos y acompañamientos.'
    )),
    'role_permissions', v_role_permissions
  );
end;
$$;

revoke all on function mediasis.get_business_products_permission_catalog(uuid, uuid) from public, anon, authenticated;
grant execute on function mediasis.get_business_products_permission_catalog(uuid, uuid) to service_role;

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

  -- Clerk may encode the active Organization using the compact `o.id` claim.
  -- Keep the legacy `org_id` form for compatibility with older templates.
  v_org_id := coalesce(
    nullif(pg_catalog.btrim(auth.jwt() ->> 'org_id'), ''),
    nullif(pg_catalog.btrim(auth.jwt() #>> '{o,id}'), ''),
    nullif(pg_catalog.btrim(auth.jwt() #>> '{organization,id}'), '')
  );
  if v_org_id is null then return null; end if;

  select b.uid into v_business_id
  from mediasis.businesses b
  where b.clerk_organization_id = v_org_id and coalesce(b.active, false)
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

create or replace function mediasis.can_manage_product_location(p_business_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role'
    or (
      mediasis.current_products_business_id() is not null
      and exists (
        select 1 from mediasis.business_location bl
        where bl.business_location_id = p_business_location_id
          and bl.business_uid = mediasis.current_products_business_id()
      )
      and mediasis.has_location_permission(p_business_location_id, 'products.manage.full')
    );
$$;

revoke all on function mediasis.can_manage_product_location(uuid) from public, anon;
grant execute on function mediasis.can_manage_product_location(uuid) to authenticated, service_role;

-- Preserve deployed payload implementations and keep their public signatures stable.
do $$
begin
  if to_regprocedure('mediasis.get_products_for_table_pre_products_auth()') is null then
    alter function mediasis.get_products_for_table() rename to get_products_for_table_pre_products_auth;
  end if;
  if to_regprocedure('mediasis.get_product_for_edit_pre_products_auth(uuid)') is null then
    alter function mediasis.get_product_for_edit(uuid) rename to get_product_for_edit_pre_products_auth;
  end if;
  if to_regprocedure('mediasis.add_product_pre_products_auth(jsonb)') is null then
    alter function mediasis.add_product(jsonb) rename to add_product_pre_products_auth;
  end if;
  if to_regprocedure('mediasis.update_product_from_diff_pre_products_auth(jsonb)') is null then
    alter function mediasis.update_product_from_diff(jsonb) rename to update_product_from_diff_pre_products_auth;
  end if;
  if to_regprocedure('mediasis.duplicate_product_pre_products_auth(uuid)') is null then
    alter function mediasis.duplicate_product(uuid) rename to duplicate_product_pre_products_auth;
  end if;
  if to_regprocedure('mediasis.get_business_option_groups_pre_products_auth(uuid)') is null then
    alter function mediasis.get_business_option_groups(uuid) rename to get_business_option_groups_pre_products_auth;
  end if;
end $$;

revoke all on function mediasis.get_products_for_table_pre_products_auth() from public, anon, authenticated;
revoke all on function mediasis.get_product_for_edit_pre_products_auth(uuid) from public, anon, authenticated;
revoke all on function mediasis.add_product_pre_products_auth(jsonb) from public, anon, authenticated;
revoke all on function mediasis.update_product_from_diff_pre_products_auth(jsonb) from public, anon, authenticated;
revoke all on function mediasis.duplicate_product_pre_products_auth(uuid) from public, anon, authenticated;
revoke all on function mediasis.get_business_option_groups_pre_products_auth(uuid) from public, anon, authenticated;

create or replace function mediasis.products_call_as_business(p_business_id uuid, p_function text, p_payload jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original_subject text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_business_id::text, true);
  case p_function
    when 'list' then v_result := mediasis.get_products_for_table_pre_products_auth();
    when 'edit' then v_result := mediasis.get_product_for_edit_pre_products_auth((p_payload->>'product_id')::uuid);
    when 'add' then v_result := mediasis.add_product_pre_products_auth(p_payload);
    when 'update' then v_result := mediasis.update_product_from_diff_pre_products_auth(p_payload);
    when 'duplicate' then v_result := mediasis.duplicate_product_pre_products_auth((p_payload->>'product_id')::uuid);
    when 'groups' then v_result := mediasis.get_business_option_groups_pre_products_auth(p_business_id);
    else raise exception 'Unsupported product operation';
  end case;
  perform set_config('request.jwt.claim.sub', coalesce(v_original_subject, ''), true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(v_original_subject, ''), true);
  raise;
end;
$$;

revoke all on function mediasis.products_call_as_business(uuid, text, jsonb) from public, anon, authenticated;

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
  if auth.role() = 'service_role' then return; end if;
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
    if nullif(v_location_text, '') is null then continue; end if;
    begin v_location_id := v_location_text::uuid;
    exception when invalid_text_representation then raise exception 'Invalid business location'; end;
    if not mediasis.can_manage_product_location(v_location_id) then
      raise exception 'Not allowed for this business location';
    end if;
  end loop;
end;
$$;

revoke all on function mediasis.assert_product_location_payload(jsonb) from public, anon, authenticated;

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
  if mediasis.current_legacy_business_id() is null and auth.role() <> 'service_role' and exists (
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

create or replace function mediasis.get_product_for_edit_authoritative(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_business_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
  select p.business into v_business_id from mediasis.product p where p.product_id = p_product_id;
  if v_business_id is null then raise exception 'Product not found'; end if;
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
  ) and mediasis.current_legacy_business_id() is null then
    raise exception 'Select at least one permitted location';
  end if;
  perform mediasis.assert_product_location_payload(product_data);
  if exists (
    select 1 from jsonb_array_elements(coalesce(product_data->'categories','[]'::jsonb)) c
    where not exists (select 1 from mediasis.product_category pc where pc.product_category_id=(c->>'value')::uuid and pc.business=v_business_id)
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
revoke all on function mediasis.get_product_for_edit_authoritative(uuid) from public, anon, authenticated;
revoke all on function mediasis.add_product(jsonb) from public, anon;
revoke all on function mediasis.update_product_from_diff(jsonb) from public, anon;
revoke all on function mediasis.duplicate_product(uuid) from public, anon;
revoke all on function mediasis.get_business_option_groups(uuid) from public, anon;
grant execute on function mediasis.get_products_for_table() to authenticated, service_role;
grant execute on function mediasis.get_product_for_edit(uuid) to authenticated, service_role;
grant execute on function mediasis.get_product_for_edit_authoritative(uuid) to service_role;
grant execute on function mediasis.add_product(jsonb) to authenticated, service_role;
grant execute on function mediasis.update_product_from_diff(jsonb) to authenticated, service_role;
grant execute on function mediasis.duplicate_product(uuid) to authenticated, service_role;
grant execute on function mediasis.get_business_option_groups(uuid) to authenticated, service_role;

-- Discount functions accept a business UUID for legacy compatibility. Wrap the
-- deployed implementations so that UUID is validated instead of trusted.
do $$
begin
  if to_regprocedure('mediasis.create_discount_code_pre_products_auth(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[])') is null then
    alter function mediasis.create_discount_code(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[]) rename to create_discount_code_pre_products_auth;
  end if;
  if to_regprocedure('mediasis.create_free_delivery_discount_pre_products_auth(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[])') is null then
    alter function mediasis.create_free_delivery_discount(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[]) rename to create_free_delivery_discount_pre_products_auth;
  end if;
  if to_regprocedure('mediasis.update_discount_code_pre_products_auth(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[])') is null then
    alter function mediasis.update_discount_code(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[]) rename to update_discount_code_pre_products_auth;
  end if;
  if to_regprocedure('mediasis.update_free_delivery_discount_pre_products_auth(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[])') is null then
    alter function mediasis.update_free_delivery_discount(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[]) rename to update_free_delivery_discount_pre_products_auth;
  end if;
end $$;

revoke all on function mediasis.create_discount_code_pre_products_auth(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[]) from public,anon,authenticated;
revoke all on function mediasis.create_free_delivery_discount_pre_products_auth(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[]) from public,anon,authenticated;
revoke all on function mediasis.update_discount_code_pre_products_auth(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[]) from public,anon,authenticated;
revoke all on function mediasis.update_free_delivery_discount_pre_products_auth(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[]) from public,anon,authenticated;

create or replace function mediasis.assert_product_discount_scope(
  p_business_id uuid, p_location_scope mediasis.scope, p_location_ids uuid[],
  p_product_ids uuid[], p_category_ids uuid[]
)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' and p_business_id <> mediasis.current_products_business_id() then
    raise exception 'Not authorized';
  end if;
  if auth.role() <> 'service_role' and p_location_scope = 'all' and not exists (
    select 1 from mediasis.business_memberships bm
    where bm.business_id=p_business_id and bm.app_user_id=mediasis.current_business_app_user_id()
      and bm.all_locations and bm.status='active' and bm.revoked_at is null
  ) and mediasis.current_legacy_business_id() is null then
    raise exception 'All-location access required';
  end if;
  if exists (select 1 from unnest(coalesce(p_location_ids,'{}'::uuid[])) id
    where not exists (select 1 from mediasis.business_location bl where bl.business_location_id=id and bl.business_uid=p_business_id)
       or (auth.role()<>'service_role' and not mediasis.can_manage_product_location(id))) then
    raise exception 'Invalid business location';
  end if;
  if exists (select 1 from unnest(coalesce(p_product_ids,'{}'::uuid[])) id
    where not exists (select 1 from mediasis.product p where p.product_id=id and p.business=p_business_id)) then
    raise exception 'Invalid product target';
  end if;
  if exists (select 1 from unnest(coalesce(p_category_ids,'{}'::uuid[])) id
    where not exists (select 1 from mediasis.product_category pc where pc.product_category_id=id and pc.business=p_business_id)) then
    raise exception 'Invalid category target';
  end if;
end; $$;

revoke all on function mediasis.assert_product_discount_scope(uuid,mediasis.scope,uuid[],uuid[],uuid[]) from public,anon,authenticated;

create or replace function mediasis.create_discount_code(
  p_business_uid uuid,p_active boolean,p_title text,p_code text,p_starts_at_text text,p_ends_at_text text,
  p_applies_to text,p_min_requirement_type text,p_min_amount numeric,p_min_items integer,
  p_limit_total_uses boolean,p_max_total_uses integer,p_limit_per_customer boolean,p_max_uses_per_customer integer,
  p_limit_total_discount_amount boolean,p_max_total_discount_amount numeric,p_location_scope mediasis.scope,
  p_business_location_ids uuid[],p_value_type text,p_value_amount numeric,p_selected_product_ids uuid[],p_selected_category_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform mediasis.assert_product_discount_scope(p_business_uid,p_location_scope,p_business_location_ids,p_selected_product_ids,p_selected_category_ids);
  return mediasis.create_discount_code_pre_products_auth(p_business_uid,p_active,p_title,p_code,p_starts_at_text,p_ends_at_text,p_applies_to,p_min_requirement_type,p_min_amount,p_min_items,p_limit_total_uses,p_max_total_uses,p_limit_per_customer,p_max_uses_per_customer,p_limit_total_discount_amount,p_max_total_discount_amount,p_location_scope,p_business_location_ids,p_value_type,p_value_amount,p_selected_product_ids,p_selected_category_ids);
end; $$;

create or replace function mediasis.create_free_delivery_discount(
  p_business_uid uuid,p_active boolean,p_title text,p_code text,p_starts_at_text text,p_ends_at_text text,
  p_applies_to text,p_min_requirement_type text,p_min_amount numeric,p_min_items integer,
  p_limit_total_uses boolean,p_max_total_uses integer,p_limit_per_customer boolean,p_max_uses_per_customer integer,
  p_location_scope mediasis.scope,p_business_location_ids uuid[],p_selected_product_ids uuid[],p_selected_category_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform mediasis.assert_product_discount_scope(p_business_uid,p_location_scope,p_business_location_ids,p_selected_product_ids,p_selected_category_ids);
  return mediasis.create_free_delivery_discount_pre_products_auth(p_business_uid,p_active,p_title,p_code,p_starts_at_text,p_ends_at_text,p_applies_to,p_min_requirement_type,p_min_amount,p_min_items,p_limit_total_uses,p_max_total_uses,p_limit_per_customer,p_max_uses_per_customer,p_location_scope,p_business_location_ids,p_selected_product_ids,p_selected_category_ids);
end; $$;

create or replace function mediasis.update_discount_code(
  p_discount_id uuid,p_business_uid uuid,p_active boolean,p_title text,p_code text,p_starts_at_text text,p_ends_at_text text,
  p_applies_to text,p_min_requirement_type text,p_min_amount numeric,p_min_items integer,
  p_limit_total_uses boolean,p_max_total_uses integer,p_limit_per_customer boolean,p_max_uses_per_customer integer,
  p_limit_total_discount_amount boolean,p_max_total_discount_amount numeric,p_location_scope mediasis.scope,
  p_business_location_ids uuid[],p_value_type text,p_value_amount numeric,p_selected_product_ids uuid[],p_selected_category_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from mediasis.discounts d where d.discount_id=p_discount_id and d.business_uid=p_business_uid) then raise exception 'Discount not found'; end if;
  perform mediasis.assert_product_discount_scope(p_business_uid,p_location_scope,p_business_location_ids,p_selected_product_ids,p_selected_category_ids);
  return mediasis.update_discount_code_pre_products_auth(p_discount_id,p_business_uid,p_active,p_title,p_code,p_starts_at_text,p_ends_at_text,p_applies_to,p_min_requirement_type,p_min_amount,p_min_items,p_limit_total_uses,p_max_total_uses,p_limit_per_customer,p_max_uses_per_customer,p_limit_total_discount_amount,p_max_total_discount_amount,p_location_scope,p_business_location_ids,p_value_type,p_value_amount,p_selected_product_ids,p_selected_category_ids);
end; $$;

create or replace function mediasis.update_free_delivery_discount(
  p_discount_id uuid,p_business_uid uuid,p_active boolean,p_title text,p_code text,p_starts_at_text text,p_ends_at_text text,
  p_applies_to text,p_min_requirement_type text,p_min_amount numeric,p_min_items integer,
  p_limit_total_uses boolean,p_max_total_uses integer,p_limit_per_customer boolean,p_max_uses_per_customer integer,
  p_location_scope mediasis.scope,p_business_location_ids uuid[],p_selected_product_ids uuid[],p_selected_category_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from mediasis.discounts d where d.discount_id=p_discount_id and d.business_uid=p_business_uid) then raise exception 'Discount not found'; end if;
  perform mediasis.assert_product_discount_scope(p_business_uid,p_location_scope,p_business_location_ids,p_selected_product_ids,p_selected_category_ids);
  return mediasis.update_free_delivery_discount_pre_products_auth(p_discount_id,p_business_uid,p_active,p_title,p_code,p_starts_at_text,p_ends_at_text,p_applies_to,p_min_requirement_type,p_min_amount,p_min_items,p_limit_total_uses,p_max_total_uses,p_limit_per_customer,p_max_uses_per_customer,p_location_scope,p_business_location_ids,p_selected_product_ids,p_selected_category_ids);
end; $$;

revoke all on function mediasis.create_discount_code(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[]) from public,anon;
revoke all on function mediasis.create_free_delivery_discount(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[]) from public,anon;
revoke all on function mediasis.update_discount_code(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[]) from public,anon;
revoke all on function mediasis.update_free_delivery_discount(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[]) from public,anon;
grant execute on function mediasis.create_discount_code(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[]) to authenticated,service_role;
grant execute on function mediasis.create_free_delivery_discount(uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[]) to authenticated,service_role;
grant execute on function mediasis.update_discount_code(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,boolean,numeric,mediasis.scope,uuid[],text,numeric,uuid[],uuid[]) to authenticated,service_role;
grant execute on function mediasis.update_free_delivery_discount(uuid,uuid,boolean,text,text,text,text,text,text,numeric,integer,boolean,integer,boolean,integer,mediasis.scope,uuid[],uuid[],uuid[]) to authenticated,service_role;

-- Clerk uploads are limited to business-scoped product/category paths. Legacy
-- policies remain untouched for compatibility with unmigrated dashboard areas.
drop policy if exists "clerk product managers upload product media" on storage.objects;
create policy "clerk product managers upload product media"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('products', 'categories')
  and (storage.foldername(name))[1] = mediasis.current_products_business_id()::text
  and mediasis.current_products_business_id() is not null
);

drop policy if exists "clerk product managers update product media" on storage.objects;
create policy "clerk product managers update product media"
on storage.objects for update to authenticated
using (
  bucket_id in ('products', 'categories')
  and (storage.foldername(name))[1] = mediasis.current_products_business_id()::text
  and mediasis.current_products_business_id() is not null
)
with check (
  bucket_id in ('products', 'categories')
  and (storage.foldername(name))[1] = mediasis.current_products_business_id()::text
  and mediasis.current_products_business_id() is not null
);

commit;

-- Verification (read-only after applying):
-- select permission_key, active from mediasis.business_permissions
-- where permission_key in ('products.manage.full','products.read','products.manage');
-- select p.oid::regprocedure, p.prosecdef, p.proconfig from pg_proc p
-- join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='mediasis' and p.proname like '%product%';
