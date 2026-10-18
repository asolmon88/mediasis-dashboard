# Clerk authentication and Mediasis authorization architecture

Status: historical planning document. For the implemented runtime architecture,
current permission model, staff access, and developer guidance, read
[`dashboard-authentication-and-authorization.md`](dashboard-authentication-and-authorization.md).

## Decisions

- Clerk owns identity, authentication, sessions, verification, and invitations.
- Supabase/Postgres owns authorization and Row Level Security.
- One `mediasis.businesses` row maps to one Clerk Organization.
- `mediasis.business_location` rows remain children of a business.
- Consumers use personal Clerk accounts and do not require an Organization.
- Business users join one or more Clerk Organizations.
- Mediasis employees use a separate internal authorization model.
- Permission checks, not role-name checks, protect application operations.
- Clerk Organization context must always be validated against Mediasis memberships.
- New foreign keys propagate key updates with `ON UPDATE CASCADE`.
- Authorization records use logical deletion; physical deletes are blocked.

## Existing canonical entities

The existing database remains authoritative for businesses and locations:

- Business primary key: `mediasis.businesses.uid`
- Location primary key: `mediasis.business_location.business_location_id`
- Existing location-to-business column: `mediasis.business_location.business_uid`

The existing `businesses.uid` values must remain stable. They currently also act as
Supabase Auth user IDs, but after migration they will be business identifiers only.

The defaults `auth.uid()` on `businesses.uid` and
`business_location.business_uid` must eventually be removed. This should happen
only after all business-creation code explicitly supplies the appropriate business
ID.

## Identity

### `mediasis.app_users`

Local application representation of a Clerk identity. This table is not a password
or session store.

| Column | Type | Notes |
| --- | --- | --- |
| `app_user_id` | `uuid` | Internal immutable primary key |
| `clerk_user_id` | `text` | Unique Clerk `sub` identifier |
| `primary_email` | `text` | Nullable cached contact data |
| `display_name` | `text` | Nullable cached profile data |
| `avatar_url` | `text` | Nullable |
| `status` | `text` | `active`, `suspended`, or `deleted` |
| `deleted_at` | `timestamptz` | Required when status is `deleted` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

The internal UUID prevents the whole relational model from depending directly on
an external provider's identifier format. RLS resolves the Clerk `sub` to this row.

### `mediasis.consumer_profiles`

Optional consumer-specific data, separated from universal identity data.

| Column | Type | Notes |
| --- | --- | --- |
| `app_user_id` | `uuid` | PK/FK to `app_users` |
| `phone_number` | `text` | Nullable |
| `deleted_at` | `timestamptz` | Logical deletion timestamp |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Future consumer-owned entities—addresses, favorites, carts, reservations, and
orders—should reference `app_user_id` where applicable.

## Business-to-Clerk mapping

Add to `mediasis.businesses`:

| Column | Type | Notes |
| --- | --- | --- |
| `clerk_organization_id` | `text` | Nullable during migration, unique when present |

The mapping must never be inferred from names, slugs, or email domains.

## Business authorization

### `mediasis.business_permissions`

Global catalogue of capabilities supported by Mediasis.

| Column | Type | Notes |
| --- | --- | --- |
| `permission_key` | `text` | Primary key, e.g. `products.manage` |
| `name` | `text` | Display name |
| `description` | `text` | Nullable |
| `active` | `boolean` | Allows retiring a permission |
| `archived_at` | `timestamptz` | Required when inactive |

Initial permission groups:

- `business.read`
- `business.manage`
- `locations.read`
- `locations.manage`
- `orders.read`
- `orders.manage`
- `products.read`
- `products.manage`
- `reservations.read`
- `reservations.manage`
- `members.read`
- `members.invite`
- `members.change_role`
- `members.change_location_access`
- `members.remove`
- `roles.read`
- `roles.manage`
- `billing.read`
- `billing.manage`

The catalogue can exist before every permission is used by the UI.

### `mediasis.business_roles`

Roles are business-scoped permission bundles.

| Column | Type | Notes |
| --- | --- | --- |
| `business_role_id` | `uuid` | Primary key |
| `business_id` | `uuid` | FK to `businesses.uid`; nullable only for a future template |
| `role_key` | `text` | Stable machine-readable key |
| `name` | `text` | Mutable display name |
| `description` | `text` | Nullable |
| `role_origin` | `enum` | `system`, `template`, or `custom` |
| `is_editable` | `boolean` | Whether the business may change it |
| `active` | `boolean` | Archive instead of deleting used roles |
| `archived_at` | `timestamptz` | Required when inactive |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

`system` roles are created and managed by Mediasis for a particular business.
`template` roles are global, non-editable starting points and are not assigned
directly. `custom` roles belong to and are editable by one business.

`role_key` is unique within a business. The initial seeded role is
`business_full_access`. Application authorization must check permissions rather
than this role key.

### `mediasis.business_role_permissions`

| Column | Type | Notes |
| --- | --- | --- |
| `business_role_id` | `uuid` | FK to `business_roles` |
| `permission_key` | `text` | FK to `business_permissions` |

Composite primary key: (`business_role_id`, `permission_key`).
`revoked_at` logically removes and can later restore an assignment.

### `mediasis.business_memberships`

Connects a Clerk identity to an Mediasis business.

| Column | Type | Notes |
| --- | --- | --- |
| `business_membership_id` | `uuid` | Primary key |
| `business_id` | `uuid` | FK to `businesses.uid` |
| `app_user_id` | `uuid` | FK to `app_users` |
| `clerk_membership_id` | `text` | Unique, nullable during migration |
| `status` | `text` | `invited`, `active`, `suspended`, `revoked` |
| `revoked_at` | `timestamptz` | Required when status is `revoked` |
| `all_locations` | `boolean` | Initial full-access memberships use `true` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Unique active relationship: (`business_id`, `app_user_id`).

### `mediasis.business_membership_roles`

| Column | Type | Notes |
| --- | --- | --- |
| `business_membership_id` | `uuid` | FK to `business_memberships` |
| `business_role_id` | `uuid` | FK to `business_roles` |

Composite primary key: (`business_membership_id`, `business_role_id`).
`revoked_at` logically removes and can later restore an assignment.

The initial product assigns exactly one role per membership, while this relation
allows multiple roles later without a schema change.

### `mediasis.business_membership_locations`

Used only when `business_memberships.all_locations = false`.

| Column | Type | Notes |
| --- | --- | --- |
| `business_membership_id` | `uuid` | FK to `business_memberships` |
| `business_location_id` | `uuid` | FK to `business_location` |

Composite primary key: (`business_membership_id`, `business_location_id`).
Database constraints or triggers must ensure that the location belongs to the
membership's business.
`revoked_at` logically removes and can later restore a grant.

## Internal Mediasis authorization

The internal model must not reuse customer-managed business roles.

### `mediasis.staff_permissions`

Initial catalogue:

- `backoffice.access`
- `businesses.access`
- `operations.access`
- `users.access`
- `settings.access`

### `mediasis.staff_roles`

Same role concepts as business roles, but managed only by Mediasis. The initial role
is `mediasis_full_access`.

### `mediasis.staff_role_permissions`

Maps internal roles to internal permissions.
Assignments use `revoked_at` instead of physical deletion.

### `mediasis.staff_memberships`

| Column | Type | Notes |
| --- | --- | --- |
| `staff_membership_id` | `uuid` | Primary key |
| `app_user_id` | `uuid` | Unique FK to `app_users` |
| `staff_role_id` | `uuid` | Initial single internal role |
| `status` | `text` | `active`, `suspended`, `revoked` |
| `revoked_at` | `timestamptz` | Required when status is `revoked` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `mediasis.staff_business_grants`

Reserved for future scoped or temporary staff access.

| Column | Type | Notes |
| --- | --- | --- |
| `staff_membership_id` | `uuid` | FK to `staff_memberships` |
| `business_id` | `uuid` | FK to `businesses.uid` |
| `access_level` | `text` | Future coarse grant level |
| `expires_at` | `timestamptz` | Nullable |
| `revoked_at` | `timestamptz` | Logical removal timestamp |
| `reason` | `text` | Nullable |

Initially, `mediasis_full_access` grants all-business access without requiring one row
per business.

## Referential and deletion behavior

- Every foreign key introduced by these drafts uses `ON UPDATE CASCADE`.
- Every foreign key uses `ON DELETE RESTRICT`; no authorization record is
  cascade-deleted or detached with `SET NULL`.
- Users and memberships are removed with `status` plus `deleted_at`/`revoked_at`.
- Roles and permissions are removed with `active = false` plus `archived_at`.
- Role, permission, location, and staff grant assignments use `revoked_at`.
- Database triggers reject direct `DELETE` statements on authorization domain
  tables. The audit log is append-only and also rejects updates.
- Webhook event rows are operational delivery records and may be subject to a
  separately approved retention/purge policy.

## Audit and synchronization

### `mediasis.authorization_audit_log`

Records invitations, membership changes, role assignments, location grants, staff
access changes, and sensitive authorization operations.

Important fields include actor, subject, business, action, before/after values,
request identifier, and timestamp.

### `mediasis.clerk_webhook_events`

Stores Clerk webhook event IDs and processing status to make synchronization
idempotent. Webhooks must be signature-verified before writes.

Clerk remains the source for authentication and Organization invitation state.
Mediasis remains the source for database authorization. Synchronization failures must
be visible and retryable.

## Authorization helpers

Planned security-definer functions with an explicit empty `search_path`:

- `mediasis.current_clerk_user_id()`
- `mediasis.current_app_user_id()`
- `mediasis.has_business_membership(business_id)`
- `mediasis.has_business_permission(business_id, permission_key)`
- `mediasis.has_location_permission(location_id, permission_key)`
- `mediasis.has_staff_permission(permission_key)`

These helpers will be used by RLS. Browser navigation visibility is only a user
experience feature and is not an authorization boundary.

## Consumer ownership

Consumer authorization is relationship-based rather than role-based:

- Public, published business data may be read by anonymous and authenticated users.
- A consumer may read/update only rows associated with their own `app_user_id`.
- Orders and reservations must explicitly record the authenticated consumer when
  one exists.
- Anonymous cart access must use an unguessable ownership secret or server-managed
  session; a globally readable/updatable anonymous cart table is not acceptable.

The current `cart` and `orders` policies are permissive and require a separate,
careful hardening migration to avoid breaking checkout.

## Migration sequence

1. Create identity and authorization tables without changing current behavior.
2. Seed permission catalogues and the two initial full-access role types.
3. Add nullable Clerk Organization mapping to businesses.
4. Create Clerk users/Organizations and backfill mappings.
5. Backfill one business membership and full-access role for each existing owner.
6. Update applications to authenticate with Clerk tokens.
7. Add Clerk-aware RLS helpers and new policies alongside controlled rollout.
8. Replace direct `auth.uid() = businesses.uid` assumptions.
9. Remove `auth.uid()` defaults from business identifiers.
10. Harden consumer, cart, order, rider, vehicle, Storage, and Realtime policies.
11. Retire Supabase Auth login only after migration verification and rollback window.

## Current security findings

- `mediasis.riders` has RLS disabled even though policies exist.
- `mediasis.vehicles` has RLS disabled even though policies exist.
- Current `mediasis.cart` anonymous policies allow unrestricted reads and updates.
- Current `mediasis.orders` policies are broadly permissive.
- Current business policies equate a business UUID with a Supabase Auth user UUID.

These findings are documented only. No remediation has been applied, because
policy changes can interrupt production ordering and rider workflows.
