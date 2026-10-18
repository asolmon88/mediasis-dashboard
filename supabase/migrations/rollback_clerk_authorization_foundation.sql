-- Explicit rollback for the Clerk authorization foundation drafts.
-- This intentionally fails if the foundation contains user, membership, mapping,
-- audit, webhook, or custom-role data. Review before use.

begin;

do $$
begin
  if exists (select 1 from mediasis.app_users)
    or exists (select 1 from mediasis.business_memberships)
    or exists (select 1 from mediasis.staff_memberships)
    or exists (select 1 from mediasis.authorization_audit_log)
    or exists (select 1 from mediasis.clerk_webhook_events)
    or exists (
      select 1 from mediasis.businesses
      where clerk_organization_id is not null
    )
    or exists (
      select 1 from mediasis.business_roles
      where role_origin <> 'system'
         or role_key <> 'business_full_access'
    )
    or exists (
      select 1 from mediasis.staff_roles
      where role_key <> 'mediasis_full_access'
    )
  then
    raise exception
      'Rollback refused: authorization foundation contains mapped or user-created data';
  end if;
end
$$;

drop function if exists mediasis.has_staff_permission(text);
drop function if exists mediasis.has_location_permission(uuid, text);
drop function if exists mediasis.has_business_permission(uuid, text);
drop function if exists mediasis.has_business_membership(uuid);
drop function if exists mediasis.current_app_user_id();
drop function if exists mediasis.current_clerk_user_id();

drop trigger if exists authorization_audit_log_append_only
  on mediasis.authorization_audit_log;
drop function if exists mediasis.prevent_authorization_audit_mutation();

drop table if exists mediasis.clerk_webhook_events;
drop table if exists mediasis.authorization_audit_log;

drop table if exists mediasis.staff_business_grants;
drop table if exists mediasis.staff_memberships;
drop table if exists mediasis.staff_role_permissions;
drop table if exists mediasis.staff_roles;
drop table if exists mediasis.staff_permissions;

drop table if exists mediasis.business_membership_locations;
drop function if exists mediasis.enforce_membership_location_scope();
drop function if exists mediasis.enforce_all_locations_transition();
drop table if exists mediasis.business_membership_roles;
drop table if exists mediasis.business_memberships;
drop table if exists mediasis.business_role_permissions;
drop table if exists mediasis.business_roles;
drop table if exists mediasis.business_permissions;

alter table mediasis.business_location
  drop constraint if exists business_location_id_business_uid_unique;

drop type if exists mediasis.business_role_origin;

drop table if exists mediasis.consumer_profiles;
drop table if exists mediasis.app_users;
drop function if exists mediasis.prevent_authorization_physical_delete();

drop index if exists mediasis.businesses_clerk_organization_id_unique;
alter table mediasis.businesses
  drop column if exists clerk_organization_id;

commit;
