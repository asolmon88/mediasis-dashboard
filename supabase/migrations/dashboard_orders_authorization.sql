-- Migration: 042
-- Full business-visible Orders authorization for Clerk dashboard members.
-- Review and apply after 041_business_team_management.sql.
-- This migration preserves legacy Supabase/Flutter signatures and guest checkout policies.

begin;

insert into mediasis.business_permissions (permission_key, name, description)
values (
  'orders.manage.full',
  'Administrar todos los pedidos',
  'Ver y administrar los pedidos visibles del negocio en las ubicaciones permitidas.'
)
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key)
select br.business_role_id, 'orders.manage.full'
from mediasis.business_roles br
where br.role_key = 'business_full_access'
  and br.role_origin = 'system'
  and br.business_id is not null
  and br.active
  and br.archived_at is null
on conflict (business_role_id, permission_key) do update
set revoked_at = null;

-- Supplemental catalogue keeps migration 041 deployable as-is while exposing
-- this newly migrated capability to the existing role editor.
create or replace function mediasis.get_business_orders_permission_catalog(
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
    select jsonb_agg(brp.permission_key order by brp.permission_key) as permission_keys
    from mediasis.business_role_permissions brp
    where brp.business_role_id = br.business_role_id
      and brp.permission_key = 'orders.manage.full'
      and brp.revoked_at is null
  ) keys on true
  where br.business_id = p_business_id and br.active and br.archived_at is null;

  return jsonb_build_object(
    'success', true,
    'permissions', jsonb_build_array(jsonb_build_object(
      'key', 'orders.manage.full',
      'name', 'Administrar todos los pedidos',
      'description', 'Ver y administrar pedidos en las ubicaciones permitidas.'
    )),
    'role_permissions', v_role_permissions
  );
end;
$$;

revoke all on function mediasis.get_business_orders_permission_catalog(uuid, uuid) from public, anon, authenticated;
grant execute on function mediasis.get_business_orders_permission_catalog(uuid, uuid) to service_role;

create or replace function mediasis.can_manage_full_orders_location(p_business_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role'
    or mediasis.has_location_permission(p_business_location_id, 'orders.manage.full');
$$;

revoke all on function mediasis.can_manage_full_orders_location(uuid) from public, anon;
grant execute on function mediasis.can_manage_full_orders_location(uuid) to authenticated, service_role;

-- Preserve the exact deployed payload implementations. The public names below
-- become authorization wrappers without changing arguments or JSON contracts.
do $$
begin
  if to_regprocedure('mediasis.get_orders_for_real_time_pre_042(uuid)') is null then
    alter function mediasis.get_orders_for_real_time(uuid) rename to get_orders_for_real_time_pre_042;
  end if;
  if to_regprocedure('mediasis.get_order_for_real_time_pre_042(uuid,uuid)') is null then
    alter function mediasis.get_order_for_real_time(uuid,uuid) rename to get_order_for_real_time_pre_042;
  end if;
  if to_regprocedure('mediasis.get_order_detail_pre_042(uuid)') is null then
    alter function mediasis.get_order_detail(uuid) rename to get_order_detail_pre_042;
  end if;
  if to_regprocedure('mediasis.get_orders_table_pre_042(uuid,integer,integer,text,text,mediasis.order_status[],mediasis.payment_status[],uuid[],timestamptz,timestamptz)') is null then
    alter function mediasis.get_orders_table(uuid,integer,integer,text,text,mediasis.order_status[],mediasis.payment_status[],uuid[],timestamptz,timestamptz)
      rename to get_orders_table_pre_042;
  end if;
end
$$;

revoke all on function mediasis.get_orders_for_real_time_pre_042(uuid) from public, anon, authenticated;
revoke all on function mediasis.get_order_for_real_time_pre_042(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.get_order_detail_pre_042(uuid) from public, anon, authenticated;
revoke all on function mediasis.get_orders_table_pre_042(uuid,integer,integer,text,text,mediasis.order_status[],mediasis.payment_status[],uuid[],timestamptz,timestamptz) from public, anon, authenticated;

create or replace function mediasis.get_orders_for_real_time(p_business_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not mediasis.can_manage_full_orders_location(p_business_location_id) then
    return jsonb_build_object('success', false, 'message', 'Not allowed for this business location');
  end if;
  return mediasis.get_orders_for_real_time_pre_042(p_business_location_id);
end;
$$;

create or replace function mediasis.get_order_for_real_time(p_order_id uuid, p_business_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not mediasis.can_manage_full_orders_location(p_business_location_id)
     or not exists (
       select 1 from mediasis.orders o
       where o.order_id = p_order_id and o.business_location_id = p_business_location_id
     ) then
    return jsonb_build_object('success', false, 'message', 'Order not found or not eligible');
  end if;
  return mediasis.get_order_for_real_time_pre_042(p_order_id, p_business_location_id);
end;
$$;

create or replace function mediasis.get_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_location_id uuid;
begin
  select o.business_location_id into v_location_id
  from mediasis.orders o where o.order_id = p_order_id;
  if v_location_id is null or not mediasis.can_manage_full_orders_location(v_location_id) then
    return jsonb_build_object('success', false, 'message', 'Order not found');
  end if;
  return mediasis.get_order_detail_pre_042(p_order_id);
end;
$$;

-- The deployed legacy table function contains its own auth.uid() ownership
-- guard. After the stronger permission/location check succeeds, this wrapper
-- temporarily supplies that business UUID only to the nested legacy payload
-- function and restores the original claim before returning.
create or replace function mediasis.get_orders_table(
  p_business_location_id uuid,
  p_limit integer default 50,
  p_offset integer default 0,
  p_sort_by text default 'created_at',
  p_sort_direction text default 'desc',
  p_order_status mediasis.order_status[] default null,
  p_payment_status mediasis.payment_status[] default null,
  p_payment_method uuid[] default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_original_subject text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
begin
  if not mediasis.can_manage_full_orders_location(p_business_location_id) then
    return jsonb_build_object('success', false, 'message', 'Not allowed for this business location');
  end if;
  select bl.business_uid into v_business_id
  from mediasis.business_location bl
  where bl.business_location_id = p_business_location_id;

  perform set_config('request.jwt.claim.sub', v_business_id::text, true);
  v_result := mediasis.get_orders_table_pre_042(
    p_business_location_id, p_limit, p_offset, p_sort_by, p_sort_direction,
    p_order_status, p_payment_status, p_payment_method, p_date_from, p_date_to
  );
  perform set_config('request.jwt.claim.sub', coalesce(v_original_subject, ''), true);
  return v_result;
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(v_original_subject, ''), true);
  raise;
end;
$$;

create or replace function mediasis.get_my_business_order_delivery_totals(p_order_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', o.order_id,
    'delivery_total', coalesce(o.delivery_price, 0) + coalesce(o.service_fee, 0)
  )), '[]'::jsonb)
  from mediasis.orders o
  where o.order_id = any(coalesce(p_order_ids, '{}'::uuid[]))
    and mediasis.can_manage_full_orders_location(o.business_location_id);
$$;

revoke all on function mediasis.get_orders_for_real_time(uuid) from public, anon;
revoke all on function mediasis.get_order_for_real_time(uuid,uuid) from public, anon;
revoke all on function mediasis.get_order_detail(uuid) from public, anon;
revoke all on function mediasis.get_orders_table(uuid,integer,integer,text,text,mediasis.order_status[],mediasis.payment_status[],uuid[],timestamptz,timestamptz) from public, anon;
revoke all on function mediasis.get_my_business_order_delivery_totals(uuid[]) from public, anon;
grant execute on function mediasis.get_orders_for_real_time(uuid) to authenticated, service_role;
grant execute on function mediasis.get_order_for_real_time(uuid,uuid) to authenticated, service_role;
grant execute on function mediasis.get_order_detail(uuid) to authenticated, service_role;
grant execute on function mediasis.get_orders_table(uuid,integer,integer,text,text,mediasis.order_status[],mediasis.payment_status[],uuid[],timestamptz,timestamptz) to authenticated, service_role;
grant execute on function mediasis.get_my_business_order_delivery_totals(uuid[]) to authenticated, service_role;

drop policy if exists "clerk full order managers can read allowed orders" on mediasis.orders;
create policy "clerk full order managers can read allowed orders"
on mediasis.orders for select to authenticated
using (mediasis.has_location_permission(business_location_id, 'orders.manage.full'));

drop policy if exists "clerk full order managers can update allowed orders" on mediasis.orders;
create policy "clerk full order managers can update allowed orders"
on mediasis.orders for update to authenticated
using (mediasis.has_location_permission(business_location_id, 'orders.manage.full'))
with check (mediasis.has_location_permission(business_location_id, 'orders.manage.full'));

drop policy if exists "clerk full order managers can read allowed uber deliveries" on mediasis.uber_deliveries;
create policy "clerk full order managers can read allowed uber deliveries"
on mediasis.uber_deliveries for select to authenticated
using (mediasis.has_location_permission(business_location_id, 'orders.manage.full'));

commit;

-- Verification (read-only after applying):
-- select permission_key, active from mediasis.business_permissions where permission_key = 'orders.manage.full';
-- select count(*) from mediasis.business_roles br join mediasis.business_role_permissions brp using (business_role_id)
-- where br.role_key = 'business_full_access' and brp.permission_key = 'orders.manage.full' and brp.revoked_at is null;
