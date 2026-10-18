# Dashboard authentication and authorization

This document explains how identity, authentication, business roles, location
scope, Mediasis staff access, and legacy compatibility work in the pharmacy
dashboard. It is intended to be the starting point for developers changing any
dashboard page, server action, RPC, RLS policy, Realtime subscription, team
management flow, or Clerk integration.

The most important rule is:

> Authentication proves who the person is. Authorization decides which
> business, locations, resources, and operations that person may access.

Never treat a successful Clerk or Supabase login as sufficient authorization.

## 1. System overview

The dashboard currently supports three authorization modes during the migration
from legacy Supabase business accounts to Clerk:

| Mode | Authentication | Business selection | Authorization |
| --- | --- | --- | --- |
| `legacy` | Supabase Auth | The Supabase subject UUID is the business UUID | Historical single-business owner access |
| `clerk` | Clerk | Active Clerk Organization mapped to an Mediasis business | Mediasis business membership, roles, permissions, and location grants |
| `staff` | Clerk | Mediasis staff business selector | Active Mediasis staff role with all-business access |

The central server resolver is
[`src/lib/dashboard/auth.ts`](../src/lib/dashboard/auth.ts). It returns a
`DashboardAuthorizationContext`, defined in
[`src/lib/dashboard/auth-types.ts`](../src/lib/dashboard/auth-types.ts).

```text
Clerk or Supabase session
        │
        ▼
Synchronize/resolve app_users identity
        │
        ├── legacy subject UUID ──► legacy business
        ├── Clerk Organization ───► mapped business membership
        └── active Mediasis staff ───► staff-selected business
        │
        ▼
DashboardAuthorizationContext
        │
        ├── active business
        ├── allowed businesses
        ├── effective permissions
        ├── all-locations flag
        └── allowed locations
```

The context is used for presentation and routing, but it is not the only
security boundary. Every sensitive server action and database operation must
revalidate authorization.

## 2. Host-based authentication mode

Authentication mode is selected by hostname in
[`src/lib/clerk/config.ts`](../src/lib/clerk/config.ts):

- `dashboard.mediasis.cr` uses the legacy Supabase login.
- `dashboard.mediasis.cr` and Mediasis `.app` subdomains use Clerk.
- Unknown/local hosts use hybrid behavior for development.

Middleware in [`src/middleware.ts`](../src/middleware.ts):

- redirects signed-out Clerk dashboard requests to `/clerk-auth/sign-in`;
- redirects legacy hosts to `/auth/login`;
- prevents public dashboard registration;
- permits Clerk users to enter only dashboard sections that have completed the
  authorization migration;
- does not replace page/action/RPC authorization.

The Clerk and Supabase feature flags and keys must agree. A Clerk component must
never render without `ClerkProvider`, and a Clerk-token Supabase client must not
call `supabase.auth.*` methods.

## 3. Unified identity: `app_users`

`mediasis.app_users` is the local identity for a person authenticated by Clerk.
It maps Clerk's stable user ID (`sub`) to an Mediasis UUID:

```text
Clerk user
   └── app_users
       ├── consumer_profiles
       ├── business_memberships (zero or many businesses)
       └── staff_memberships (optional Mediasis employee access)
```

An account is not permanently classified as only a consumer, pharmacy user,
or staff user. The same `app_users` row may have all three relationships.

The table stores identity metadata, status, and logical deletion state. It does
not store passwords or sessions. Clerk owns Clerk passwords and sessions.

On a Clerk dashboard request, `synchronizeClerkIdentity()` updates the local
name, email, avatar, and active identity mapping. Deleting or revoking a
business membership must not delete the Clerk identity, consumer profile,
orders, cashback, or memberships in other businesses.

## 4. Clerk Organizations and businesses

Every migrated business maps one-to-one to a Clerk Organization through:

```text
mediasis.businesses.clerk_organization_id
```

Clerk Organization membership is necessary for ordinary pharmacy accounts,
but Clerk Organization roles are not the data authorization authority. A user
being `org:admin` does not by itself grant access to Mediasis tables.

Mediasis independently requires:

1. an active `app_users` identity;
2. an active business;
3. an active `business_memberships` row;
4. active Mediasis role assignments;
5. the exact Mediasis permission;
6. location access when the operation is location-scoped.

This duplicate validation is intentional. Clerk manages identity, sessions,
Organization membership, and invitations; Mediasis owns application permissions.

## 5. Pharmacy RBAC data model

### Permission catalogue

`mediasis.business_permissions` contains exact permission keys. Permissions are
capabilities, not wildcards and not hierarchical prefixes. For example,
`orders.manage.full` does not automatically grant a future
`orders.payment_pending.read` permission.

Important current permissions include:

| Area | Permission |
| --- | --- |
| Analytics | `analytics.read` |
| Business market | `business.market_settings.read` |
| Orders | `orders.manage.full` |
| Products | `products.manage.full` |
| Ordering app: Inicio/Checkout/Apariencia | `ordering_app.storefront.manage.full` |
| Ordering app: Delivery | `ordering_app.delivery.manage.full` |
| Ordering app: schedules | `ordering_app.schedules.manage.full` |
| Ordering app: payment methods | `ordering_app.payment_methods.manage.full` |
| Ordering app: cashback | `ordering_app.cashback.manage.full` |
| Dashboard app automatic statuses | `dashboard_app.automatic_statuses.manage.full` |
| Reservations | `reservations.manage.full` |
| Developer tools | `developer.manage.full` |
| Team visibility | `members.read` |
| Invitations/accounts | `members.invite` |
| Member roles | `members.change_role` |
| Member locations | `members.change_location_access` |
| Suspend/remove members | `members.remove` |
| Role visibility | `roles.read` |
| Role management | `roles.manage` |

Older keys such as `orders.read`, `orders.manage`, `products.read`, and
`products.manage` are compatibility catalogue entries. Migrated dashboard
sections use the newer exact `.manage.full` permissions.

### Roles

`mediasis.business_roles` defines roles. A role belongs to one business unless it
is a template. Role origins are:

- `system`: Mediasis-managed business role;
- `template`: global non-business template;
- `custom`: editable role owned by one business.

`mediasis.business_role_permissions` assigns permission keys to roles. Revocation
is logical through `revoked_at`.

Every business has a protected `business_full_access` system role. It is not
editable and is assigned every active business permission. Migrations that add
a permission must also grant it to all active `business_full_access` roles.

The role editor exposes only capabilities whose dashboard authorization slice
has been implemented. A permission existing in the catalogue does not mean its
page is safe to expose automatically.

## Business market configuration

Every business belongs to exactly one country and all of its locations inherit
that business-level market. `mediasis.market_country_profiles` is the extensible
catalogue of supported countries; `mediasis.business_market_settings` stores the
selected profile as a private snapshot so later catalogue edits cannot silently
change an existing business.

The authorization context exposes this snapshot as `market`. Dashboard code
must use its IANA timezone, ISO currency code, locale, phone country, and
capabilities. It must not infer these values from a location or silently fall
back to Costa Rica. Legacy owners may view the market. Clerk pharmacy users
need `business.market_settings.read`; only Mediasis staff with
`businesses.market.correct` can correct it through the service RPC.

Country or currency changes are rejected once commercial data or monetary
configuration exists and then require a dedicated data migration. Business
provisioning accepts a catalogue `country_code`, snapshots the active profile,
and leaves `app_active=false` until the storefront supports that market.

### Memberships

`mediasis.business_memberships` connects a person to a business. A usable
membership must have:

- `status = 'active'`;
- `revoked_at is null`;
- an active role assignment in `business_membership_roles`;
- a valid location scope.

The database schema supports multiple role assignments. The current dashboard
team UI intentionally assigns one active role per member.

The last active `business_full_access` administrator cannot be removed,
suspended, downgraded, or location-restricted. Team mutations lock relevant
membership rows to enforce this invariant under concurrency.

## 6. Location authorization

Location scope is independent from role permissions:

- `business_memberships.all_locations = true` grants every location in that
  business.
- When `all_locations = false`, active rows in
  `business_membership_locations` grant individual locations.

Composite foreign keys guarantee that a membership and its granted locations
belong to the same business. Foreign keys use `ON UPDATE CASCADE` so replacing
a `business_location_id` does not break memberships or migrated configuration
tables.

Database guards require explicit location grants to be removed before changing
a membership to all-location access. Team-management RPCs perform transitions
in the correct atomic order; do not reproduce those transitions with browser
table writes.

Location-scoped pages must expose only allowed locations. Restricted edits must
preserve hidden assignments rather than deleting them because the browser did
not submit them. This is why delivery methods, payment methods, schedules,
products, and Checkout configuration use server-side lock-and-merge operations.

Some sections have an additional eligibility gate. Reservations require both
the permission and `business_location.reservation_active = true`.

## 7. Mediasis staff authorization

Mediasis employees are deliberately separate from pharmacy roles.

The relevant tables are:

- `staff_permissions`;
- `staff_roles`;
- `staff_role_permissions`;
- `staff_memberships`;
- `staff_business_grants` for future or restricted per-business access.

The protected `mediasis_full_access` staff role:

- is active and non-editable;
- has `grants_all_businesses = true`;
- receives every active internal staff permission;
- includes `businesses.create`;
- allows staff to select any active business without creating a pharmacy
  membership for every business.

`is_mediasis_staff_actor(app_user_id)` validates the complete chain: active local
identity, active staff membership, active role, and `grants_all_businesses`.

For dashboard presentation, active full-access staff receive `permissions: ['*']`.
The helper `hasDashboardPermission()` interprets this wildcard so every migrated
sidebar entry and page is visible.

This wildcard is not database authority. Database functions independently use
`is_mediasis_staff_actor`, `is_current_mediasis_staff`,
`team_actor_has_permission`, ownership checks, and resource validation. Never
change an RPC to trust a browser-supplied `'*'` or `mode: 'staff'` value.

Staff operate with `allLocations = true`. The selected business is stored in an
HTTP-only `mediasis_staff_business_id` cookie. Staff can configure a newly created
business before `app_active` is enabled; pharmacy and legacy users retain the
normal `app_active` gate.

The initial protected bootstrap accounts are synchronized in
[`src/lib/dashboard/auth.ts`](../src/lib/dashboard/auth.ts). Permanent staff
management belongs to the internal Mediasis admin system; do not expand the
bootstrap email list as a normal provisioning workflow.

## 8. Legacy Supabase compatibility

Legacy mode exists to avoid downtime for the web dashboard and Flutter app.
The legacy Supabase JWT subject is a UUID that must exactly match an active
`businesses.uid`.

`current_legacy_business_id()` safely validates and parses the subject.
Legacy access is restricted to that one business. It does not grant access to
other business UUIDs.

Migrated dual-mode RPCs preserve the existing legacy call signatures and
response contracts while adding Clerk authorization. Existing Flutter RPCs,
Realtime subscriptions, and narrowly scoped table policies must be regression
tested before changing or removing a legacy policy.

Do not:

- reinterpret an arbitrary Clerk `sub` as a business UUID;
- remove a legacy policy before its required web and Flutter operations have a
  verified replacement;
- use a Clerk-token Supabase client's `auth.getUser`, `getClaims`, or
  `onAuthStateChange` methods;
- change Supabase business passwords while migrating Clerk passwords.

## 9. Authorization helpers

The main database helpers are:

| Helper | Purpose |
| --- | --- |
| `current_legacy_business_id()` | Resolve a valid legacy business subject |
| `current_business_app_user_id()` | Resolve Clerk `sub` to `app_users` |
| `has_business_access(business_id)` | Validate business access in legacy, Clerk, or staff mode |
| `has_business_permission(business_id, key)` | Validate exact business capability |
| `has_location_permission(location_id, key)` | Validate capability plus location scope |
| `team_actor_has_permission(business_id, actor, key)` | Validate a trusted server-supplied actor for team/service operations |
| `is_mediasis_staff_actor(app_user_id)` | Validate Mediasis all-business staff status |
| `get_dashboard_authorization_context(business_id)` | Build legacy/pharmacy context |
| `get_staff_dashboard_authorization_context(business_id)` | Build staff context |
| `can_create_business()` | Validate platform or staff business-creation permission |

Authorization helpers use fixed empty `search_path` and fully qualified objects.
`SECURITY DEFINER` functions must revoke unnecessary execution from `PUBLIC`,
`anon`, and `authenticated`. Service-role-only functions must be callable only
from reviewed server code after caller authorization.

Some service-only configuration RPCs accept a null actor for an already
authorized full-scope path. This convention is safe only when:

1. execution is restricted to `service_role`;
2. the server action first resolves `DashboardAuthorizationContext`;
3. the server derives the business ID from that context;
4. ordinary Clerk pharmacy users provide their real `app_user_id`;
5. the RPC validates all resource ownership.

Never expose such an RPC directly to the browser.

## 10. Enforcement layers

Every migrated capability should be enforced at all applicable layers:

1. **Middleware:** the route is part of the Clerk-migrated allowlist.
2. **Layout/page:** require the exact permission before rendering data.
3. **Navigation:** hide unavailable entries for Clerk users.
4. **Server action/API route:** resolve trusted dashboard context again.
5. **RPC:** validate business, permission, resource ownership, and location.
6. **RLS:** protect direct reads, mutations, and Realtime where browser access
   remains necessary.
7. **Storage:** validate bucket, path, business, and resource ownership.

Hiding a sidebar item is not authorization. A direct URL or manipulated request
must still fail at the server/database boundary.

## 11. Adding a business permission

Use a reviewable migration in `supabase/migrations`. Filenames are descriptive;
the sequence is recorded in a header:

```sql
-- Migration: NNN
-- Purpose: Describe the authorization slice.
```

Permission keys should be stable, exact, and descriptive:

```sql
insert into mediasis.business_permissions (
  permission_key, name, description, active, archived_at
)
values (
  'example.manage.full',
  'Administrar ejemplo',
  'Manage the complete business-visible example area.',
  true,
  null
)
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (
  business_role_id, permission_key, revoked_at
)
select br.business_role_id, 'example.manage.full', null
from mediasis.business_roles br
where br.role_key = 'business_full_access'
  and br.active
  and br.archived_at is null
on conflict (business_role_id, permission_key)
do update set revoked_at = null;
```

Then implement the complete slice:

1. add a server authorization helper using `hasDashboardPermission`;
2. add the route to middleware's Clerk allowlist;
3. gate sidebar/page rendering;
4. migrate actions away from `auth.uid() = business_id` assumptions;
5. add dual legacy/Clerk RPC authorization;
6. enforce location scope where applicable;
7. add the permission to team-management role catalogue data;
8. test full-access, restricted-role, no-permission, staff, legacy, and
   cross-business cases.

Do not make permission matching prefix-based. Future sensitive capabilities
must not be inherited accidentally.

## 12. Creating and assigning roles

Prefer **Configuración → Usuarios → Roles** because it uses authorized,
audited, tenant-scoped server operations.

At the database level, a custom role consists of:

1. one `business_roles` row with `role_origin = 'custom'` and
   `is_editable = true`;
2. one `business_role_permissions` row per selected permission;
3. an assignment through `business_membership_roles`.

Runtime role changes should use the team-management RPCs rather than direct
browser writes. Those RPCs verify that:

- the actor has `roles.manage` or the appropriate `members.*` permission;
- the actor cannot grant a permission they do not hold;
- role and membership belong to the active business;
- protected roles are not edited;
- the business retains at least one full-access administrator;
- location IDs belong to the business.

Roles are logically archived. Do not physically delete roles, memberships, or
authorization audit history.

## 13. Invitations and reserved users

The business team manager supports two provisioning modes:

- **Invitation:** Clerk sends an Organization invitation. On acceptance, Mediasis
  reuses or creates the local identity and activates the intended role/scope.
- **Reserved account:** an authorized administrator supplies an email and
  initial password. The server creates the Clerk identity without exposing the
  Clerk secret or persisting the plaintext password.

If an email already exists in Clerk, reserved creation must not overwrite its
password. Use the existing-identity invitation flow.

`business_invitations` stores correlation IDs, intended role/location scope,
Clerk identifiers, status, and safe errors. Clerk metadata may contain an opaque
correlation reference, but it is not trusted as the role definition.

Removing a business user revokes only that business membership and Clerk
Organization membership. It must preserve other business memberships and all
consumer/transactional data.

## 14. Business creation

Only callers for whom `can_create_business()` returns true may create a
business. Currently Mediasis full-access staff receive `businesses.create`.
Pharmacy full-access roles do not implicitly receive this platform capability.

Business creation is idempotent and staged:

1. create a provisioning record;
2. create an inaccessible business and first location;
3. create full-access role and creator membership;
4. create the Clerk Organization;
5. add the creator as Clerk `org:admin`;
6. checkpoint Clerk identifiers;
7. activate the business and complete provisioning.

Retries reuse the idempotency record and Clerk private business metadata. They
must never create a duplicate business or Organization.

The database now seeds new businesses with the standard delivery and payment
methods through `seed_business_ordering_defaults`. This provisioning invariant
must remain independent of the UI creation path.

## 15. RLS, Realtime, and service-role access

New authorization tables have RLS enabled. Browser roles do not receive direct
financial or authorization mutations.

Realtime is special because the browser subscribes directly. Migrated Realtime
tables require dual-mode RLS so:

- legacy users retain their existing business/location behavior;
- Clerk users receive only permitted business locations;
- subscription filters do not replace RLS;
- refreshed Clerk JWTs are used on reconnect.

The service role bypasses RLS and is therefore not authorization. Server code
using `createAdminClient()` must first authenticate the caller, derive the
business from trusted context, and pass only validated identifiers to a
restricted operation.

## 16. Common failure modes

### Page is visible but says “Not authorized”

Check, in order:

1. Clerk session and Organization selection;
2. `app_users` identity status;
3. business/Organization mapping;
4. active membership and role assignment;
5. permission catalogue active state;
6. role-permission `revoked_at`;
7. location scope;
8. page helper and RPC using the same exact permission key.

### Mediasis staff can see navigation but an RPC fails

The UI wildcard is working, but the database operation may not recognize staff
or the server may be passing the wrong actor. Verify `is_mediasis_staff_actor`,
`team_actor_has_permission`, service-only grants, and trusted business ID flow.

### Legacy account suddenly loses access

Look for a migrated RPC or policy that removed the explicit
`current_legacy_business_id()` path, or client code that constructed a
Clerk-token Supabase client for a legacy operation.

### Location-restricted save deletes hidden configuration

The mutation is replacing assignments from the browser payload instead of
locking and merging permitted assignments with protected hidden assignments.

### `auth.uid()` or Clerk `sub` is treated as a business ID

This is incorrect for Clerk identities. Resolve the active business through
`DashboardAuthorizationContext` and verify it again in PostgreSQL.

## 17. Required regression matrix

Every authorization change should test at least:

- legacy Supabase owner;
- Clerk `business_full_access` administrator;
- Clerk custom role with the permission;
- Clerk custom role without the permission;
- location-restricted Clerk member;
- Mediasis full-access staff;
- suspended and revoked memberships;
- manipulated business, location, and resource IDs;
- direct route and direct server-action/API attempts;
- Realtime reconnect where applicable;
- Flutter compatibility for shared legacy RPCs and tables.

Also run TypeScript, production build, SQL verification, and `git diff --check`.

## 18. Primary source files

- [`src/lib/dashboard/auth.ts`](../src/lib/dashboard/auth.ts): central context
  resolution and Clerk identity synchronization.
- [`src/lib/dashboard/auth-types.ts`](../src/lib/dashboard/auth-types.ts):
  context contract and wildcard-aware UI permission helper.
- [`src/middleware.ts`](../src/middleware.ts): host authentication mode and
  migrated-route boundary.
- [`src/lib/clerk/config.ts`](../src/lib/clerk/config.ts): hostname and Clerk
  feature configuration.
- [`src/lib/supabase/server.ts`](../src/lib/supabase/server.ts): Clerk-token and
  legacy cookie-backed server clients.
- [`src/components/app-sidebar.tsx`](../src/components/app-sidebar.tsx):
  permission-aware navigation.
- [`src/app/admin/settings/users/actions.ts`](../src/app/admin/settings/users/actions.ts):
  team and role server operations.
- [`supabase/migrations/clerk_identity_foundation.sql`](../supabase/migrations/clerk_identity_foundation.sql)
- [`supabase/migrations/business_authorization.sql`](../supabase/migrations/business_authorization.sql)
- [`supabase/migrations/staff_authorization.sql`](../supabase/migrations/staff_authorization.sql)
- [`supabase/migrations/business_auth_compatibility.sql`](../supabase/migrations/business_auth_compatibility.sql)
- [`supabase/migrations/business_team_management.sql`](../supabase/migrations/business_team_management.sql)
- [`supabase/migrations/dashboard_mediasis_staff_administrators.sql`](../supabase/migrations/dashboard_mediasis_staff_administrators.sql)
- [`supabase/migrations/fix_mediasis_staff_full_dashboard_access.sql`](../supabase/migrations/fix_mediasis_staff_full_dashboard_access.sql)

When implementation and this document disagree, treat the code and applied
database schema as the runtime truth, then update this document in the same
change that corrects the discrepancy.
