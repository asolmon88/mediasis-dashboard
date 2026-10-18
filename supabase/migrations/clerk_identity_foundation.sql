-- Migration: 001
-- Clerk identity foundation for Mediasis.
-- Draft only: review before copying into the active Supabase migrations directory.

begin;

create table if not exists mediasis.app_users (
  app_user_id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  primary_email text,
  display_name text,
  avatar_url text,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_clerk_user_id_not_blank
    check (btrim(clerk_user_id) <> ''),
  constraint app_users_status_valid
    check (status in ('active', 'suspended', 'deleted')),
  constraint app_users_logical_delete_valid
    check (
      (status = 'deleted' and deleted_at is not null)
      or
      (status <> 'deleted' and deleted_at is null)
    ),
  constraint app_users_clerk_user_id_unique
    unique (clerk_user_id)
);

comment on table mediasis.app_users is
  'Local application identity mapped to Clerk. Does not store passwords or sessions.';
comment on column mediasis.app_users.clerk_user_id is
  'Stable Clerk user ID from the JWT sub claim.';

create unique index if not exists app_users_primary_email_unique
  on mediasis.app_users (lower(primary_email))
  where primary_email is not null and status <> 'deleted';

create table if not exists mediasis.consumer_profiles (
  app_user_id uuid primary key
    references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  phone_number text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table mediasis.consumer_profiles is
  'Consumer-specific profile data. Authorization is ownership-based, not role-based.';
comment on column mediasis.consumer_profiles.deleted_at is
  'Logical deletion timestamp. Physical deletion is reserved for an explicitly reviewed purge.';

alter table mediasis.businesses
  add column if not exists clerk_organization_id text;

create unique index if not exists businesses_clerk_organization_id_unique
  on mediasis.businesses (clerk_organization_id)
  where clerk_organization_id is not null;

comment on column mediasis.businesses.clerk_organization_id is
  'Clerk Organization ID mapped one-to-one to this Mediasis business.';

alter table mediasis.app_users enable row level security;
alter table mediasis.consumer_profiles enable row level security;

-- No client policies are intentionally added in the foundation release.
-- Server synchronization uses a privileged server client; later application RLS
-- migrations will grant narrowly scoped consumer access.

commit;
