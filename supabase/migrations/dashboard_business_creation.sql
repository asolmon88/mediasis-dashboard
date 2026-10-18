-- Migration: 039
-- Permissioned, idempotent dashboard business provisioning.
-- Clerk Organization creation happens server-side between begin and complete.

begin;

create table if not exists mediasis.platform_permissions (
  permission_key text primary key,
  name text not null,
  description text,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_permissions_key_format
    check (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint platform_permissions_archive_valid check (active = (archived_at is null))
);

create table if not exists mediasis.app_user_platform_permissions (
  app_user_id uuid not null
    references mediasis.app_users(app_user_id) on update cascade on delete restrict,
  permission_key text not null
    references mediasis.platform_permissions(permission_key) on update cascade on delete restrict,
  granted_by_app_user_id uuid
    references mediasis.app_users(app_user_id) on update cascade on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (app_user_id, permission_key)
);

create table if not exists mediasis.business_provisioning_requests (
  business_provisioning_request_id uuid primary key default gen_random_uuid(),
  creator_app_user_id uuid not null
    references mediasis.app_users(app_user_id) on update cascade on delete restrict,
  idempotency_key uuid not null,
  requested_business_name text not null,
  requested_location_name text not null,
  requested_phone text not null,
  requested_lat numeric not null,
  requested_lng numeric not null,
  business_id uuid
    references mediasis.businesses(uid) on update cascade on delete restrict,
  business_location_id uuid
    references mediasis.business_location(business_location_id) on update cascade on delete restrict,
  clerk_organization_id text,
  status text not null default 'pending',
  last_error text,
  failed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_provisioning_creator_key_unique unique (creator_app_user_id, idempotency_key),
  constraint business_provisioning_status_valid
    check (status in ('pending', 'organization_created', 'completed', 'failed')),
  constraint business_provisioning_names_not_blank
    check (btrim(requested_business_name) <> '' and btrim(requested_location_name) <> ''),
  constraint business_provisioning_coordinates_valid
    check (requested_lat between -90 and 90 and requested_lng between -180 and 180)
);

create unique index if not exists business_provisioning_business_unique
  on mediasis.business_provisioning_requests(business_id) where business_id is not null;
create unique index if not exists business_provisioning_clerk_org_unique
  on mediasis.business_provisioning_requests(clerk_organization_id)
  where clerk_organization_id is not null;

alter table mediasis.platform_permissions enable row level security;
alter table mediasis.app_user_platform_permissions enable row level security;
alter table mediasis.business_provisioning_requests enable row level security;

insert into mediasis.platform_permissions (permission_key, name, description)
values ('businesses.create', 'Create businesses', 'Create and immediately administer new Mediasis businesses.')
on conflict (permission_key) do update
set name = excluded.name, description = excluded.description,
    active = true, archived_at = null, updated_at = now();

insert into mediasis.staff_permissions (permission_key, name, description)
values ('businesses.create', 'Create businesses', 'Create businesses from the normal or internal Mediasis dashboard.')
on conflict (permission_key) do update
set name = excluded.name, description = excluded.description,
    active = true, archived_at = null, updated_at = now();

insert into mediasis.staff_role_permissions (staff_role_id, permission_key)
select sr.staff_role_id, 'businesses.create'
from mediasis.staff_roles sr
where sr.role_key = 'mediasis_full_access' and sr.active
on conflict (staff_role_id, permission_key) do update set revoked_at = null;

create or replace function mediasis.can_create_business()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from mediasis.app_user_platform_permissions upp
    join mediasis.platform_permissions pp on pp.permission_key = upp.permission_key
    where upp.app_user_id = mediasis.current_business_app_user_id()
      and upp.permission_key = 'businesses.create'
      and upp.revoked_at is null
      and pp.active
      and pp.archived_at is null
  ) or mediasis.has_staff_permission('businesses.create');
$$;

create or replace function mediasis.begin_dashboard_business_provisioning(
  p_idempotency_key uuid,
  p_business_name text,
  p_location_name text,
  p_phone text,
  p_lat numeric,
  p_lng numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := mediasis.current_business_app_user_id();
  v_request mediasis.business_provisioning_requests%rowtype;
  v_business_id uuid;
  v_location_id uuid;
  v_role_id uuid;
  v_membership_id uuid;
begin
  if v_creator is null or not mediasis.can_create_business() then
    raise exception 'No tenés permiso para crear negocios';
  end if;
  if p_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  if btrim(coalesce(p_business_name, '')) = '' or btrim(coalesce(p_location_name, '')) = '' then
    raise exception 'Business and location names are required';
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid business coordinates';
  end if;

  select * into v_request
  from mediasis.business_provisioning_requests bpr
  where bpr.creator_app_user_id = v_creator and bpr.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_request.status = 'failed' then
      -- Reuse the inaccessible business/location created by the first attempt.
      -- External Clerk failures must be retryable with the same idempotency key
      -- and must never create a second Mediasis business.
      update mediasis.business_provisioning_requests
      set status = 'pending', failed_at = null, last_error = null, updated_at = now()
      where business_provisioning_request_id = v_request.business_provisioning_request_id
      returning * into v_request;
    end if;
    return jsonb_build_object(
      'success', true, 'status', v_request.status,
      'business_id', v_request.business_id,
      'business_location_id', v_request.business_location_id,
      'clerk_organization_id', v_request.clerk_organization_id,
      'message', v_request.last_error
    );
  end if;

  v_business_id := gen_random_uuid();
  v_location_id := gen_random_uuid();

  insert into mediasis.businesses (uid, full_name, active, app_active, hub_visible)
  values (v_business_id, btrim(p_business_name), false, false, false);
  insert into mediasis.business_location (
    business_uid, business_location_id, short_name, phone_number, lat, lng
  ) values (
    v_business_id, v_location_id, btrim(p_location_name), btrim(p_phone), p_lat, p_lng
  );

  insert into mediasis.business_roles (
    business_id, role_key, name, description, role_origin, is_editable
  ) values (
    v_business_id, 'business_full_access', 'Full access',
    'Mediasis-managed role with every active business permission.',
    'system'::mediasis.business_role_origin, false
  ) returning business_role_id into v_role_id;

  insert into mediasis.business_role_permissions (business_role_id, permission_key)
  select v_role_id, bp.permission_key from mediasis.business_permissions bp where bp.active;

  insert into mediasis.business_memberships (
    business_id, app_user_id, status, revoked_at, all_locations
  ) values (v_business_id, v_creator, 'active', null, true)
  returning business_membership_id into v_membership_id;
  insert into mediasis.business_membership_roles (
    business_membership_id, business_role_id, business_id, revoked_at
  ) values (v_membership_id, v_role_id, v_business_id, null);

  insert into mediasis.business_provisioning_requests (
    creator_app_user_id, idempotency_key, requested_business_name,
    requested_location_name, requested_phone, requested_lat, requested_lng,
    business_id, business_location_id, status
  ) values (
    v_creator, p_idempotency_key, btrim(p_business_name), btrim(p_location_name),
    btrim(p_phone), p_lat, p_lng, v_business_id, v_location_id, 'pending'
  ) returning * into v_request;

  return jsonb_build_object(
    'success', true, 'status', v_request.status,
    'business_provisioning_request_id', v_request.business_provisioning_request_id,
    'business_id', v_business_id, 'business_location_id', v_location_id,
    'creator_app_user_id', v_creator
  );
end;
$$;

create or replace function mediasis.record_dashboard_business_organization(
  p_business_id uuid,
  p_clerk_organization_id text,
  p_clerk_membership_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request mediasis.business_provisioning_requests%rowtype;
begin
  select * into v_request from mediasis.business_provisioning_requests
  where business_id = p_business_id for update;
  if not found then raise exception 'Provisioning request not found'; end if;
  if v_request.status = 'completed' then
    return jsonb_build_object('success', true, 'duplicate', true, 'business_id', p_business_id);
  end if;
  if v_request.clerk_organization_id is not null
    and v_request.clerk_organization_id <> p_clerk_organization_id then
    raise exception 'A different Clerk Organization is already recorded';
  end if;

  update mediasis.businesses
  set clerk_organization_id = p_clerk_organization_id
  where uid = p_business_id;
  update mediasis.business_memberships
  set clerk_membership_id = coalesce(nullif(btrim(p_clerk_membership_id), ''), clerk_membership_id),
      updated_at = now()
  where business_id = p_business_id and app_user_id = v_request.creator_app_user_id;
  update mediasis.business_provisioning_requests
  set clerk_organization_id = p_clerk_organization_id, status = 'organization_created',
      failed_at = null, last_error = null, updated_at = now()
  where business_provisioning_request_id = v_request.business_provisioning_request_id;

  return jsonb_build_object('success', true, 'status', 'organization_created', 'business_id', p_business_id);
end;
$$;

create or replace function mediasis.complete_dashboard_business_provisioning(
  p_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request mediasis.business_provisioning_requests%rowtype;
begin
  select * into v_request from mediasis.business_provisioning_requests
  where business_id = p_business_id for update;
  if not found then raise exception 'Provisioning request not found'; end if;
  if v_request.status = 'completed' then
    return jsonb_build_object('success', true, 'duplicate', true, 'business_id', p_business_id);
  end if;
  if v_request.status <> 'organization_created' or v_request.clerk_organization_id is null then
    raise exception 'The Clerk Organization has not been recorded';
  end if;

  update mediasis.businesses set active = true where uid = p_business_id;
  update mediasis.business_provisioning_requests
  set status = 'completed', completed_at = now(), updated_at = now()
  where business_provisioning_request_id = v_request.business_provisioning_request_id;
  return jsonb_build_object('success', true, 'status', 'completed', 'business_id', p_business_id);
end;
$$;

create or replace function mediasis.reconcile_dashboard_business_organization(
  p_business_id uuid,
  p_clerk_organization_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mapped jsonb;
  v_request_id uuid;
begin
  v_mapped := mediasis.map_clerk_organization_to_business(p_business_id, p_clerk_organization_id);

  select bpr.business_provisioning_request_id into v_request_id
  from mediasis.business_provisioning_requests bpr
  where bpr.business_id = p_business_id
  for update;

  if v_request_id is null then
    return jsonb_build_object('success', true, 'existing_business', true, 'business_id', p_business_id);
  end if;

  update mediasis.business_provisioning_requests
  set clerk_organization_id = p_clerk_organization_id,
      status = 'completed', completed_at = coalesce(completed_at, now()),
      failed_at = null, last_error = null, updated_at = now()
  where business_provisioning_request_id = v_request_id;
  update mediasis.businesses set active = true where uid = p_business_id;

  return jsonb_build_object('success', true, 'completed', true, 'business_id', p_business_id);
end;
$$;

create or replace function mediasis.fail_dashboard_business_provisioning(
  p_business_id uuid,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update mediasis.business_provisioning_requests
  set status = 'failed', last_error = left(coalesce(p_error, 'Unknown provisioning error'), 1000),
      failed_at = now(), updated_at = now()
  where business_id = p_business_id and status <> 'completed';
  return jsonb_build_object('success', true, 'business_id', p_business_id);
end;
$$;

revoke all on table mediasis.platform_permissions from public, anon, authenticated;
revoke all on table mediasis.app_user_platform_permissions from public, anon, authenticated;
revoke all on table mediasis.business_provisioning_requests from public, anon, authenticated;
revoke all on function mediasis.can_create_business() from public, anon;
revoke all on function mediasis.begin_dashboard_business_provisioning(uuid, text, text, text, numeric, numeric) from public, anon;
revoke all on function mediasis.record_dashboard_business_organization(uuid, text, text) from public, anon, authenticated;
revoke all on function mediasis.complete_dashboard_business_provisioning(uuid) from public, anon, authenticated;
revoke all on function mediasis.reconcile_dashboard_business_organization(uuid, text) from public, anon, authenticated;
revoke all on function mediasis.fail_dashboard_business_provisioning(uuid, text) from public, anon, authenticated;
grant execute on function mediasis.can_create_business() to authenticated, service_role;
grant execute on function mediasis.begin_dashboard_business_provisioning(uuid, text, text, text, numeric, numeric) to authenticated, service_role;
grant execute on function mediasis.record_dashboard_business_organization(uuid, text, text) to service_role;
grant execute on function mediasis.complete_dashboard_business_provisioning(uuid) to service_role;
grant execute on function mediasis.reconcile_dashboard_business_organization(uuid, text) to service_role;
grant execute on function mediasis.fail_dashboard_business_provisioning(uuid, text) to service_role;

commit;
