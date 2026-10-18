-- Migration: 005
-- Clerk-aware authorization helper functions.
-- Depends on 001-003. These functions are not attached to production RLS yet.

begin;

create or replace function mediasis.current_clerk_user_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(auth.jwt() ->> 'sub'), '');
$$;

create or replace function mediasis.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select au.app_user_id
  from mediasis.app_users au
  where au.clerk_user_id = mediasis.current_clerk_user_id()
    and au.status = 'active'
  limit 1;
$$;

create or replace function mediasis.has_business_membership(requested_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_business_id is not null
    and exists (
      select 1
      from mediasis.business_memberships bm
      join mediasis.app_users au on au.app_user_id = bm.app_user_id
      join mediasis.businesses b on b.uid = bm.business_id
      where bm.business_id = requested_business_id
        and bm.app_user_id = mediasis.current_app_user_id()
        and bm.status = 'active'
        and au.status = 'active'
        and coalesce(b.active, false)
    );
$$;

create or replace function mediasis.has_business_permission(
  requested_business_id uuid,
  requested_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_business_id is not null
    and requested_permission_key is not null
    and exists (
      select 1
      from mediasis.business_memberships bm
      join mediasis.business_membership_roles bmr
        on bmr.business_membership_id = bm.business_membership_id
       and bmr.business_id = bm.business_id
      join mediasis.business_roles br
        on br.business_role_id = bmr.business_role_id
       and br.business_id = bmr.business_id
      join mediasis.business_role_permissions brp
        on brp.business_role_id = br.business_role_id
      join mediasis.business_permissions bp
        on bp.permission_key = brp.permission_key
      join mediasis.businesses b on b.uid = bm.business_id
      where bm.business_id = requested_business_id
        and bm.app_user_id = mediasis.current_app_user_id()
        and bm.status = 'active'
        and br.active
        and bp.active
        and bmr.revoked_at is null
        and brp.revoked_at is null
        and coalesce(b.active, false)
        and bp.permission_key = requested_permission_key
    );
$$;

create or replace function mediasis.has_location_permission(
  requested_location_id uuid,
  requested_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_location_id is not null
    and requested_permission_key is not null
    and exists (
      select 1
      from mediasis.business_location bl
      join mediasis.business_memberships bm
        on bm.business_id = bl.business_uid
      join mediasis.businesses b on b.uid = bm.business_id
      join mediasis.business_membership_roles bmr
        on bmr.business_membership_id = bm.business_membership_id
       and bmr.business_id = bm.business_id
      join mediasis.business_roles br
        on br.business_role_id = bmr.business_role_id
       and br.business_id = bmr.business_id
      join mediasis.business_role_permissions brp
        on brp.business_role_id = br.business_role_id
      join mediasis.business_permissions bp
        on bp.permission_key = brp.permission_key
      where bl.business_location_id = requested_location_id
        and bm.app_user_id = mediasis.current_app_user_id()
        and bm.status = 'active'
        and br.active
        and bp.active
        and bmr.revoked_at is null
        and brp.revoked_at is null
        and coalesce(b.active, false)
        and bp.permission_key = requested_permission_key
        and (
          bm.all_locations
          or exists (
            select 1
            from mediasis.business_membership_locations bml
            where bml.business_membership_id = bm.business_membership_id
              and bml.business_id = bm.business_id
              and bml.business_location_id = bl.business_location_id
              and bml.revoked_at is null
          )
        )
    );
$$;

create or replace function mediasis.has_staff_permission(requested_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_permission_key is not null
    and exists (
      select 1
      from mediasis.staff_memberships sm
      join mediasis.app_users au on au.app_user_id = sm.app_user_id
      join mediasis.staff_roles sr on sr.staff_role_id = sm.staff_role_id
      join mediasis.staff_role_permissions srp on srp.staff_role_id = sr.staff_role_id
      join mediasis.staff_permissions sp on sp.permission_key = srp.permission_key
      where sm.app_user_id = mediasis.current_app_user_id()
        and sm.status = 'active'
        and au.status = 'active'
        and sr.active
        and sp.active
        and srp.revoked_at is null
        and sp.permission_key = requested_permission_key
    );
$$;

revoke all on function mediasis.current_clerk_user_id() from public;
revoke all on function mediasis.current_app_user_id() from public;
revoke all on function mediasis.has_business_membership(uuid) from public;
revoke all on function mediasis.has_business_permission(uuid, text) from public;
revoke all on function mediasis.has_location_permission(uuid, text) from public;
revoke all on function mediasis.has_staff_permission(text) from public;

grant execute on function mediasis.current_clerk_user_id() to authenticated;
grant execute on function mediasis.current_app_user_id() to authenticated;
grant execute on function mediasis.has_business_membership(uuid) to authenticated;
grant execute on function mediasis.has_business_permission(uuid, text) to authenticated;
grant execute on function mediasis.has_location_permission(uuid, text) to authenticated;
grant execute on function mediasis.has_staff_permission(text) to authenticated;

comment on function mediasis.current_clerk_user_id() is
  'Returns the Clerk user ID from the current third-party JWT sub claim.';
comment on function mediasis.has_business_permission(uuid, text) is
  'Checks active Mediasis membership and role permissions; Clerk organization context alone is insufficient.';

commit;
