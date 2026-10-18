-- Migration: 006
-- Initial permission catalogues and full-access roles.
-- Depends on 001-003. Safe to re-run.

begin;

insert into mediasis.business_permissions (permission_key, name, description)
values
  ('business.read', 'View business', 'View private business configuration.'),
  ('business.manage', 'Manage business', 'Change business configuration.'),
  ('locations.read', 'View locations', 'View business locations and configuration.'),
  ('locations.manage', 'Manage locations', 'Create and change business locations.'),
  ('orders.read', 'View orders', 'View orders for allowed locations.'),
  ('orders.manage', 'Manage orders', 'Update and fulfill orders for allowed locations.'),
  ('products.read', 'View products', 'View private product configuration.'),
  ('products.manage', 'Manage products', 'Create and change products, categories, and options.'),
  ('reservations.read', 'View reservations', 'View reservations for allowed locations.'),
  ('reservations.manage', 'Manage reservations', 'Update reservations and reservation settings.'),
  ('members.read', 'View members', 'View business members and their access.'),
  ('members.invite', 'Invite members', 'Invite a user to the business.'),
  ('members.change_role', 'Change member roles', 'Assign or remove business roles.'),
  ('members.change_location_access', 'Change location access', 'Change the locations a member can access.'),
  ('members.remove', 'Remove members', 'Suspend or revoke a business membership.'),
  ('roles.read', 'View roles', 'View available business roles and permissions.'),
  ('roles.manage', 'Manage roles', 'Create and change business-owned roles.'),
  ('billing.read', 'View billing', 'View billing and settlement information.'),
  ('billing.manage', 'Manage billing', 'Change billing and payment configuration.')
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_roles (
  business_id,
  role_key,
  name,
  description,
  role_origin,
  is_editable
)
select
  b.uid,
  'business_full_access',
  'Full access',
  'Mediasis-managed role with every active business permission.',
  'system'::mediasis.business_role_origin,
  false
from mediasis.businesses b
on conflict (business_id, role_key) do update
set name = excluded.name,
    description = excluded.description,
    role_origin = excluded.role_origin,
    is_editable = excluded.is_editable,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key)
select br.business_role_id, bp.permission_key
from mediasis.business_roles br
cross join mediasis.business_permissions bp
where br.role_key = 'business_full_access'
  and br.role_origin = 'system'
  and br.business_id is not null
  and bp.active
on conflict (business_role_id, permission_key) do update
set revoked_at = null;

insert into mediasis.staff_permissions (permission_key, name, description)
values
  ('backoffice.access', 'Access backoffice', 'Enter the Mediasis internal backoffice.'),
  ('businesses.access', 'Access businesses', 'Access customer businesses through internal tools.'),
  ('operations.access', 'Access operations', 'Access internal operational tools.'),
  ('users.access', 'Access users', 'Manage or support Mediasis identities and memberships.'),
  ('settings.access', 'Access settings', 'Manage Mediasis-wide settings.')
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.staff_roles (
  role_key,
  name,
  description,
  is_system,
  is_editable,
  grants_all_businesses
)
values (
  'mediasis_full_access',
  'Mediasis full access',
  'Mediasis-managed role with every active internal permission and access to all businesses.',
  true,
  false,
  true
)
on conflict (role_key) do update
set name = excluded.name,
    description = excluded.description,
    is_system = excluded.is_system,
    is_editable = excluded.is_editable,
    grants_all_businesses = excluded.grants_all_businesses,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.staff_role_permissions (staff_role_id, permission_key)
select sr.staff_role_id, sp.permission_key
from mediasis.staff_roles sr
cross join mediasis.staff_permissions sp
where sr.role_key = 'mediasis_full_access'
  and sp.active
on conflict (staff_role_id, permission_key) do update
set revoked_at = null;

commit;
