-- Migration: 040
-- TEMPORARY PILOT ONLY.
-- This migration can provision only the existing Padfy legacy account:
--   business: 7e15147b-89b0-4abe-8a29-5bf7a9acb525
--   email:    lookcr506@gmail.com
-- It intentionally contains no reusable or batch migration behavior.

begin;

create or replace function mediasis.prepare_padfy_clerk_pilot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business mediasis.businesses%rowtype;
  v_auth_user auth.users%rowtype;
  v_role_id uuid;
begin
  select * into v_business
  from mediasis.businesses b
  where b.uid = '7e15147b-89b0-4abe-8a29-5bf7a9acb525'::uuid;
  if not found or v_business.full_name <> 'Padfy' then
    raise exception 'The fixed Padfy pilot business was not found';
  end if;

  select * into v_auth_user
  from auth.users u
  where u.id = v_business.uid;
  if not found or lower(pg_catalog.btrim(coalesce(v_auth_user.email, ''))) <> 'lookcr506@gmail.com' then
    raise exception 'The fixed Padfy legacy identity does not match';
  end if;
  if coalesce(v_auth_user.encrypted_password, '') !~ '^\$2[aby]\$[0-9]{2}\$' then
    raise exception 'The Padfy legacy password is not a supported bcrypt digest';
  end if;

  select br.business_role_id into v_role_id
  from mediasis.business_roles br
  where br.business_id = v_business.uid
    and br.role_key = 'business_full_access'
    and br.active
    and br.archived_at is null;
  if v_role_id is null then
    raise exception 'Padfy does not have an active business_full_access role';
  end if;

  -- The digest is returned only to the service-role pilot command. It must be
  -- sent directly to Clerk and must never be logged or persisted elsewhere.
  return pg_catalog.jsonb_build_object(
    'success', true,
    'business_id', v_business.uid,
    'business_name', v_business.full_name,
    'email', lower(pg_catalog.btrim(v_auth_user.email)),
    'password_digest', v_auth_user.encrypted_password,
    'clerk_organization_id', v_business.clerk_organization_id
  );
end;
$$;

create or replace function mediasis.complete_padfy_clerk_pilot(
  p_clerk_user_id text,
  p_clerk_organization_id text,
  p_clerk_membership_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id constant uuid := '7e15147b-89b0-4abe-8a29-5bf7a9acb525'::uuid;
  v_email constant text := 'lookcr506@gmail.com';
  v_app_user_id uuid;
  v_email_app_user_id uuid;
  v_role_id uuid;
  v_membership_id uuid;
begin
  if nullif(pg_catalog.btrim(p_clerk_user_id), '') is null
    or nullif(pg_catalog.btrim(p_clerk_organization_id), '') is null
    or nullif(pg_catalog.btrim(p_clerk_membership_id), '') is null then
    raise exception 'Clerk user, Organization, and membership IDs are required';
  end if;

  perform 1
  from mediasis.businesses b
  where b.uid = v_business_id and b.full_name = 'Padfy'
  for update;
  if not found then raise exception 'The fixed Padfy pilot business was not found'; end if;

  if exists (
    select 1 from mediasis.businesses b
    where b.clerk_organization_id = p_clerk_organization_id
      and b.uid <> v_business_id
  ) then
    raise exception 'The Clerk Organization is already mapped to another business';
  end if;

  select au.app_user_id into v_app_user_id
  from mediasis.app_users au
  where au.clerk_user_id = p_clerk_user_id
  for update;

  select au.app_user_id into v_email_app_user_id
  from mediasis.app_users au
  where lower(au.primary_email) = v_email
    and au.status <> 'deleted'
  for update;

  if v_app_user_id is not null
    and v_email_app_user_id is not null
    and v_app_user_id <> v_email_app_user_id then
    raise exception 'The Clerk user and Padfy email resolve to different Mediasis identities';
  end if;
  if v_app_user_id is null and v_email_app_user_id is not null then
    raise exception 'The Padfy email is already attached to a different Clerk identity';
  end if;

  if v_app_user_id is null then
    insert into mediasis.app_users (
      clerk_user_id, primary_email, display_name, status, deleted_at
    ) values (
      p_clerk_user_id, v_email, 'Padfy', 'active', null
    ) returning app_user_id into v_app_user_id;
  else
    update mediasis.app_users
    set primary_email = coalesce(primary_email, v_email),
        status = 'active', deleted_at = null, updated_at = now()
    where app_user_id = v_app_user_id;
  end if;

  update mediasis.businesses
  set clerk_organization_id = p_clerk_organization_id
  where uid = v_business_id
    and (clerk_organization_id is null or clerk_organization_id = p_clerk_organization_id);
  if not found then raise exception 'Padfy is mapped to a different Clerk Organization'; end if;

  select br.business_role_id into v_role_id
  from mediasis.business_roles br
  where br.business_id = v_business_id
    and br.role_key = 'business_full_access'
    and br.active
    and br.archived_at is null;
  if v_role_id is null then raise exception 'Padfy business_full_access role is missing'; end if;

  update mediasis.business_membership_locations
  set revoked_at = coalesce(revoked_at, now())
  where business_membership_id in (
    select bm.business_membership_id
    from mediasis.business_memberships bm
    where bm.business_id = v_business_id and bm.app_user_id = v_app_user_id
  ) and revoked_at is null;

  insert into mediasis.business_memberships (
    business_id, app_user_id, clerk_membership_id, status, revoked_at, all_locations
  ) values (
    v_business_id, v_app_user_id, p_clerk_membership_id, 'active', null, true
  )
  on conflict (business_id, app_user_id) do update
  set clerk_membership_id = excluded.clerk_membership_id,
      status = 'active', revoked_at = null, all_locations = true, updated_at = now()
  returning business_membership_id into v_membership_id;

  insert into mediasis.business_membership_roles (
    business_membership_id, business_role_id, business_id, revoked_at
  ) values (v_membership_id, v_role_id, v_business_id, null)
  on conflict (business_membership_id, business_role_id)
  do update set revoked_at = null;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'business_id', v_business_id,
    'app_user_id', v_app_user_id,
    'business_membership_id', v_membership_id
  );
end;
$$;

revoke all on function mediasis.prepare_padfy_clerk_pilot()
  from public, anon, authenticated;
revoke all on function mediasis.complete_padfy_clerk_pilot(text, text, text)
  from public, anon, authenticated;
grant execute on function mediasis.prepare_padfy_clerk_pilot() to service_role;
grant execute on function mediasis.complete_padfy_clerk_pilot(text, text, text) to service_role;

commit;

-- After the pilot is complete, these temporary entry points can be removed:
-- drop function if exists mediasis.prepare_padfy_clerk_pilot();
-- drop function if exists mediasis.complete_padfy_clerk_pilot(text, text, text);
