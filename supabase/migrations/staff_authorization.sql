-- Migration: 003
-- Mediasis-internal authorization, intentionally separate from business roles.
-- Depends on 001_clerk_identity_foundation.sql.

begin;

create table if not exists mediasis.staff_permissions (
  permission_key text primary key,
  name text not null,
  description text,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_permissions_key_format
    check (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint staff_permissions_name_not_blank
    check (btrim(name) <> ''),
  constraint staff_permissions_archive_valid
    check (active = (archived_at is null))
);

create table if not exists mediasis.staff_roles (
  staff_role_id uuid primary key default gen_random_uuid(),
  role_key text not null unique,
  name text not null,
  description text,
  is_system boolean not null default true,
  is_editable boolean not null default false,
  active boolean not null default true,
  archived_at timestamptz,
  grants_all_businesses boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_roles_key_format
    check (role_key ~ '^[a-z][a-z0-9_]*$'),
  constraint staff_roles_name_not_blank
    check (btrim(name) <> ''),
  constraint staff_roles_archive_valid
    check (active = (archived_at is null))
);

create table if not exists mediasis.staff_role_permissions (
  staff_role_id uuid not null
    references mediasis.staff_roles(staff_role_id)
    on update cascade on delete restrict,
  permission_key text not null
    references mediasis.staff_permissions(permission_key)
    on update cascade on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (staff_role_id, permission_key)
);

create table if not exists mediasis.staff_memberships (
  staff_membership_id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null unique
    references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  staff_role_id uuid not null
    references mediasis.staff_roles(staff_role_id)
    on update cascade on delete restrict,
  status text not null default 'active',
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_memberships_status_valid
    check (status in ('active', 'suspended', 'revoked')),
  constraint staff_memberships_logical_delete_valid
    check (
      (status = 'revoked' and revoked_at is not null)
      or
      (status <> 'revoked' and revoked_at is null)
    )
);

create table if not exists mediasis.staff_business_grants (
  staff_membership_id uuid not null
    references mediasis.staff_memberships(staff_membership_id)
    on update cascade on delete restrict,
  business_id uuid not null
    references mediasis.businesses(uid)
    on update cascade on delete restrict,
  access_level text not null default 'full',
  expires_at timestamptz,
  revoked_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  primary key (staff_membership_id, business_id),
  constraint staff_business_grants_access_level_valid
    check (access_level in ('read', 'support', 'full'))
);

create index if not exists staff_business_grants_business_idx
  on mediasis.staff_business_grants(business_id);

alter table mediasis.staff_permissions enable row level security;
alter table mediasis.staff_roles enable row level security;
alter table mediasis.staff_role_permissions enable row level security;
alter table mediasis.staff_memberships enable row level security;
alter table mediasis.staff_business_grants enable row level security;

comment on table mediasis.staff_memberships is
  'Mediasis-controlled staff authorization. Business administrators cannot manage this table.';
comment on column mediasis.staff_roles.grants_all_businesses is
  'When true, the role does not require one staff_business_grants row per business.';
comment on column mediasis.staff_business_grants.revoked_at is
  'Logical removal timestamp; clear it to restore the business grant.';

commit;
