-- Migration: 002
-- Business-scoped roles, permissions, memberships, and location access.
-- Depends on 001_clerk_identity_foundation.sql.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'mediasis' and t.typname = 'business_role_origin'
  ) then
    create type mediasis.business_role_origin as enum ('system', 'template', 'custom');
  end if;
end
$$;

create table if not exists mediasis.business_permissions (
  permission_key text primary key,
  name text not null,
  description text,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_permissions_key_format
    check (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint business_permissions_name_not_blank
    check (btrim(name) <> ''),
  constraint business_permissions_archive_valid
    check (active = (archived_at is null))
);

create table if not exists mediasis.business_roles (
  business_role_id uuid primary key default gen_random_uuid(),
  business_id uuid
    references mediasis.businesses(uid)
    on update cascade on delete restrict,
  role_key text not null,
  name text not null,
  description text,
  role_origin mediasis.business_role_origin not null,
  is_editable boolean not null default false,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_roles_key_format
    check (role_key ~ '^[a-z][a-z0-9_]*$'),
  constraint business_roles_name_not_blank
    check (btrim(name) <> ''),
  constraint business_roles_archive_valid
    check (active = (archived_at is null)),
  constraint business_roles_origin_owner_valid
    check (
      (role_origin = 'template' and business_id is null and not is_editable)
      or
      (role_origin = 'system' and business_id is not null and not is_editable)
      or
      (role_origin = 'custom' and business_id is not null and is_editable)
    ),
  constraint business_roles_id_business_unique
    unique (business_role_id, business_id),
  constraint business_roles_business_key_unique
    unique (business_id, role_key)
);

create unique index if not exists business_role_templates_key_unique
  on mediasis.business_roles(role_key)
  where business_id is null;

create table if not exists mediasis.business_role_permissions (
  business_role_id uuid not null
    references mediasis.business_roles(business_role_id)
    on update cascade on delete restrict,
  permission_key text not null
    references mediasis.business_permissions(permission_key)
    on update cascade on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (business_role_id, permission_key)
);

create table if not exists mediasis.business_memberships (
  business_membership_id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references mediasis.businesses(uid)
    on update cascade on delete restrict,
  app_user_id uuid not null
    references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  clerk_membership_id text,
  status text not null default 'invited',
  revoked_at timestamptz,
  all_locations boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_memberships_status_valid
    check (status in ('invited', 'active', 'suspended', 'revoked')),
  constraint business_memberships_logical_delete_valid
    check (
      (status = 'revoked' and revoked_at is not null)
      or
      (status <> 'revoked' and revoked_at is null)
    ),
  constraint business_memberships_clerk_id_not_blank
    check (clerk_membership_id is null or btrim(clerk_membership_id) <> ''),
  constraint business_memberships_business_user_unique
    unique (business_id, app_user_id),
  constraint business_memberships_clerk_membership_unique
    unique (clerk_membership_id),
  constraint business_memberships_id_business_unique
    unique (business_membership_id, business_id)
);

create table if not exists mediasis.business_membership_roles (
  business_membership_id uuid not null,
  business_role_id uuid not null,
  business_id uuid not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (business_membership_id, business_role_id),
  constraint business_membership_roles_membership_business_fk
    foreign key (business_membership_id, business_id)
    references mediasis.business_memberships(business_membership_id, business_id)
    on update cascade on delete restrict,
  constraint business_membership_roles_role_business_fk
    foreign key (business_role_id, business_id)
    references mediasis.business_roles(business_role_id, business_id)
    on update cascade on delete restrict
);

-- A composite candidate key is required so a location grant can enforce that
-- the membership and location belong to the same business.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'mediasis.business_location'::regclass
      and conname = 'business_location_id_business_uid_unique'
  ) then
    alter table mediasis.business_location
      add constraint business_location_id_business_uid_unique
      unique (business_location_id, business_uid);
  end if;
end
$$;

create table if not exists mediasis.business_membership_locations (
  business_membership_id uuid not null,
  business_location_id uuid not null,
  business_id uuid not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (business_membership_id, business_location_id),
  constraint business_membership_locations_membership_business_fk
    foreign key (business_membership_id, business_id)
    references mediasis.business_memberships(business_membership_id, business_id)
    on update cascade on delete restrict,
  constraint business_membership_locations_location_business_fk
    foreign key (business_location_id, business_id)
    references mediasis.business_location(business_location_id, business_uid)
    on update cascade on delete restrict
);

create or replace function mediasis.enforce_membership_location_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from mediasis.business_memberships bm
    where bm.business_membership_id = new.business_membership_id
      and bm.all_locations
      and new.revoked_at is null
  ) then
    raise exception
      'Explicit location grants require all_locations = false for membership %',
      new.business_membership_id;
  end if;

  return new;
end;
$$;

drop trigger if exists business_membership_locations_scope_guard
  on mediasis.business_membership_locations;
create trigger business_membership_locations_scope_guard
before insert or update on mediasis.business_membership_locations
for each row execute function mediasis.enforce_membership_location_scope();

create or replace function mediasis.enforce_all_locations_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.all_locations
    and not old.all_locations
    and exists (
      select 1
      from mediasis.business_membership_locations bml
      where bml.business_membership_id = new.business_membership_id
        and bml.revoked_at is null
    )
  then
    raise exception
      'Remove explicit location grants before setting all_locations = true for membership %',
      new.business_membership_id;
  end if;

  return new;
end;
$$;

drop trigger if exists business_memberships_all_locations_guard
  on mediasis.business_memberships;
create trigger business_memberships_all_locations_guard
before update of all_locations on mediasis.business_memberships
for each row execute function mediasis.enforce_all_locations_transition();

create index if not exists business_memberships_app_user_idx
  on mediasis.business_memberships(app_user_id)
  where status = 'active';
create index if not exists business_membership_roles_role_idx
  on mediasis.business_membership_roles(business_role_id);
create index if not exists business_membership_locations_location_idx
  on mediasis.business_membership_locations(business_location_id);

alter table mediasis.business_permissions enable row level security;
alter table mediasis.business_roles enable row level security;
alter table mediasis.business_role_permissions enable row level security;
alter table mediasis.business_memberships enable row level security;
alter table mediasis.business_membership_roles enable row level security;
alter table mediasis.business_membership_locations enable row level security;

comment on table mediasis.business_roles is
  'Per-business permission bundles plus global, non-assignable Mediasis templates.';
comment on column mediasis.business_roles.role_key is
  'Stable machine-readable key; UI authorization must check permissions instead.';
comment on column mediasis.business_memberships.all_locations is
  'When false, access is limited to business_membership_locations rows.';
comment on column mediasis.business_role_permissions.revoked_at is
  'Logical removal timestamp; clear it to restore the permission assignment.';
comment on column mediasis.business_membership_roles.revoked_at is
  'Logical removal timestamp; clear it to restore the role assignment.';
comment on column mediasis.business_membership_locations.revoked_at is
  'Logical removal timestamp; clear it to restore the location grant.';

commit;
