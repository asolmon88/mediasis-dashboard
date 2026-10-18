-- Migration: 007
-- Read-only verification for the Clerk authorization foundation.
-- Every query should return zero rows unless its comment states otherwise.

-- Missing expected tables.
with expected(table_name) as (
  values
    ('app_users'),
    ('consumer_profiles'),
    ('business_permissions'),
    ('business_roles'),
    ('business_role_permissions'),
    ('business_memberships'),
    ('business_membership_roles'),
    ('business_membership_locations'),
    ('staff_permissions'),
    ('staff_roles'),
    ('staff_role_permissions'),
    ('staff_memberships'),
    ('staff_business_grants'),
    ('authorization_audit_log'),
    ('clerk_webhook_events')
)
select e.table_name as missing_table
from expected e
left join information_schema.tables t
  on t.table_schema = 'mediasis' and t.table_name = e.table_name
where t.table_name is null;

-- Businesses without exactly one active full-access system role.
select b.uid as business_id, count(br.business_role_id) as full_access_role_count
from mediasis.businesses b
left join mediasis.business_roles br
  on br.business_id = b.uid
 and br.role_key = 'business_full_access'
 and br.role_origin = 'system'
 and br.active
group by b.uid
having count(br.business_role_id) <> 1;

-- Full-access business roles missing active permissions.
select br.business_id, bp.permission_key
from mediasis.business_roles br
cross join mediasis.business_permissions bp
left join mediasis.business_role_permissions brp
  on brp.business_role_id = br.business_role_id
 and brp.permission_key = bp.permission_key
 and brp.revoked_at is null
where br.role_key = 'business_full_access'
  and br.role_origin = 'system'
  and br.active
  and bp.active
  and brp.business_role_id is null;

-- The single Mediasis full-access role should exist; expected result is one row
-- with role_count = 1.
select count(*) as role_count
from mediasis.staff_roles
where role_key = 'mediasis_full_access'
  and active
  and grants_all_businesses;

-- Mediasis full-access role missing active staff permissions.
select sp.permission_key
from mediasis.staff_roles sr
cross join mediasis.staff_permissions sp
left join mediasis.staff_role_permissions srp
  on srp.staff_role_id = sr.staff_role_id
 and srp.permission_key = sp.permission_key
 and srp.revoked_at is null
where sr.role_key = 'mediasis_full_access'
  and sr.active
  and sp.active
  and srp.staff_role_id is null;

-- Invalid cross-business role assignments. The composite foreign keys should
-- make these impossible.
select bmr.*
from mediasis.business_membership_roles bmr
join mediasis.business_memberships bm
  on bm.business_membership_id = bmr.business_membership_id
join mediasis.business_roles br
  on br.business_role_id = bmr.business_role_id
where bm.business_id <> bmr.business_id
   or br.business_id <> bmr.business_id;

-- Invalid cross-business location grants.
select bml.*
from mediasis.business_membership_locations bml
join mediasis.business_memberships bm
  on bm.business_membership_id = bml.business_membership_id
join mediasis.business_location bl
  on bl.business_location_id = bml.business_location_id
where bm.business_id <> bml.business_id
   or bl.business_uid <> bml.business_id;

-- Explicit location rows are redundant for all-location memberships.
select bml.*
from mediasis.business_membership_locations bml
join mediasis.business_memberships bm
  on bm.business_membership_id = bml.business_membership_id
where bm.all_locations
  and bml.revoked_at is null;

-- Logical deletion state must be internally consistent.
select app_user_id, status, deleted_at
from mediasis.app_users
where (status = 'deleted') <> (deleted_at is not null);

select business_membership_id, status, revoked_at
from mediasis.business_memberships
where (status = 'revoked') <> (revoked_at is not null);

select staff_membership_id, status, revoked_at
from mediasis.staff_memberships
where (status = 'revoked') <> (revoked_at is not null);

select permission_key, active, archived_at
from mediasis.business_permissions
where active <> (archived_at is null);

select business_role_id, active, archived_at
from mediasis.business_roles
where active <> (archived_at is null);

select permission_key, active, archived_at
from mediasis.staff_permissions
where active <> (archived_at is null);

select staff_role_id, active, archived_at
from mediasis.staff_roles
where active <> (archived_at is null);

-- All logical-delete domain tables must have a physical DELETE guard.
with expected(table_name) as (
  values
    ('app_users'),
    ('consumer_profiles'),
    ('business_permissions'),
    ('business_roles'),
    ('business_role_permissions'),
    ('business_memberships'),
    ('business_membership_roles'),
    ('business_membership_locations'),
    ('staff_permissions'),
    ('staff_roles'),
    ('staff_role_permissions'),
    ('staff_memberships'),
    ('staff_business_grants')
)
select e.table_name as missing_delete_guard
from expected e
where not exists (
  select 1
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'mediasis'
    and c.relname = e.table_name
    and not t.tgisinternal
    and pg_get_triggerdef(t.oid) ilike '%prevent_authorization_physical_delete%'
);

-- Every foreign key introduced on the new domain tables must cascade key
-- updates and restrict physical parent deletion.
select
  c.conname as invalid_foreign_key,
  c.conrelid::regclass as child_table,
  c.confrelid::regclass as parent_table,
  c.confupdtype as update_action,
  c.confdeltype as delete_action
from pg_constraint c
join pg_class child on child.oid = c.conrelid
join pg_namespace child_schema on child_schema.oid = child.relnamespace
where c.contype = 'f'
  and child_schema.nspname = 'mediasis'
  and child.relname in (
    'consumer_profiles',
    'business_roles',
    'business_role_permissions',
    'business_memberships',
    'business_membership_roles',
    'business_membership_locations',
    'staff_role_permissions',
    'staff_memberships',
    'staff_business_grants',
    'authorization_audit_log'
  )
  and (c.confupdtype <> 'c' or c.confdeltype <> 'r');

-- Duplicate Clerk mappings. Unique indexes/constraints should make these
-- impossible, but these checks make review explicit.
select clerk_user_id, count(*)
from mediasis.app_users
group by clerk_user_id
having count(*) > 1;

select clerk_organization_id, count(*)
from mediasis.businesses
where clerk_organization_id is not null
group by clerk_organization_id
having count(*) > 1;

select clerk_event_id, count(*)
from mediasis.clerk_webhook_events
group by clerk_event_id
having count(*) > 1;

-- Confirm all new authorization tables have RLS enabled. Returns tables where
-- RLS is unexpectedly disabled.
select n.nspname as schema_name, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'mediasis'
  and c.relname in (
    'app_users',
    'consumer_profiles',
    'business_permissions',
    'business_roles',
    'business_role_permissions',
    'business_memberships',
    'business_membership_roles',
    'business_membership_locations',
    'staff_permissions',
    'staff_roles',
    'staff_role_permissions',
    'staff_memberships',
    'staff_business_grants',
    'authorization_audit_log',
    'clerk_webhook_events'
  )
  and not c.relrowsecurity;
