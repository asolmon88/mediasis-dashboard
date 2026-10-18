-- Migration: 037
-- Clerk Organization invitation and membership synchronization.
-- Depends on 036_business_auth_compatibility.sql.

begin;

create table if not exists mediasis.business_invitations (
  business_invitation_id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references mediasis.businesses(uid) on update cascade on delete restrict,
  invited_email text not null,
  business_role_id uuid not null,
  all_locations boolean not null default true,
  location_ids uuid[] not null default '{}'::uuid[],
  clerk_invitation_id text,
  correlation_id uuid not null default gen_random_uuid(),
  status text not null default 'pending',
  invited_by_app_user_id uuid
    references mediasis.app_users(app_user_id) on update cascade on delete restrict,
  accepted_by_app_user_id uuid
    references mediasis.app_users(app_user_id) on update cascade on delete restrict,
  expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_invitations_email_normalized
    check (invited_email = lower(btrim(invited_email)) and invited_email like '%@%'),
  constraint business_invitations_status_valid
    check (status in ('pending', 'accepted', 'revoked', 'expired', 'failed')),
  constraint business_invitations_location_scope_valid
    check ((all_locations and cardinality(location_ids) = 0) or not all_locations),
  constraint business_invitations_role_business_fk
    foreign key (business_role_id, business_id)
    references mediasis.business_roles(business_role_id, business_id)
    on update cascade on delete restrict,
  constraint business_invitations_correlation_unique unique (correlation_id)
);

create unique index if not exists business_invitations_clerk_id_unique
  on mediasis.business_invitations(clerk_invitation_id)
  where clerk_invitation_id is not null;
create index if not exists business_invitations_pending_idx
  on mediasis.business_invitations(business_id, invited_email, expires_at)
  where status = 'pending';

alter table mediasis.business_invitations enable row level security;

create or replace function mediasis.map_clerk_organization_to_business(
  p_business_id uuid,
  p_clerk_organization_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if nullif(pg_catalog.btrim(p_clerk_organization_id), '') is null then
    raise exception 'A Clerk Organization ID is required';
  end if;

  select b.clerk_organization_id into v_existing
  from mediasis.businesses b where b.uid = p_business_id for update;
  if not found then raise exception 'Business not found'; end if;
  if v_existing is not null and v_existing <> p_clerk_organization_id then
    raise exception 'This business is mapped to a different Clerk Organization';
  end if;
  if exists (
    select 1 from mediasis.businesses b
    where b.clerk_organization_id = p_clerk_organization_id and b.uid <> p_business_id
  ) then
    raise exception 'This Clerk Organization is mapped to a different business';
  end if;

  update mediasis.businesses
  set clerk_organization_id = p_clerk_organization_id
  where uid = p_business_id;
  return jsonb_build_object('success', true, 'business_id', p_business_id);
end;
$$;

create or replace function mediasis.register_business_invitation(
  p_business_id uuid,
  p_invited_email text,
  p_business_role_id uuid,
  p_all_locations boolean,
  p_location_ids uuid[],
  p_invited_by_app_user_id uuid,
  p_correlation_id uuid,
  p_clerk_invitation_id text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation mediasis.business_invitations%rowtype;
  v_email text := lower(pg_catalog.btrim(p_invited_email));
begin
  if v_email = '' or v_email not like '%@%' then
    raise exception 'A valid normalized invitation email is required';
  end if;

  if not coalesce(p_all_locations, true) and exists (
    select 1
    from unnest(coalesce(p_location_ids, '{}'::uuid[])) requested(location_id)
    left join mediasis.business_location bl
      on bl.business_location_id = requested.location_id
     and bl.business_uid = p_business_id
    where bl.business_location_id is null
  ) then
    raise exception 'One or more invitation locations do not belong to the business';
  end if;

  insert into mediasis.business_invitations (
    business_id, invited_email, business_role_id, all_locations, location_ids,
    invited_by_app_user_id, correlation_id, clerk_invitation_id, expires_at
  ) values (
    p_business_id, v_email, p_business_role_id, coalesce(p_all_locations, true),
    case when coalesce(p_all_locations, true) then '{}'::uuid[] else coalesce(p_location_ids, '{}'::uuid[]) end,
    p_invited_by_app_user_id, p_correlation_id, nullif(pg_catalog.btrim(p_clerk_invitation_id), ''),
    coalesce(p_expires_at, now() + interval '30 days')
  )
  on conflict (correlation_id) do update
  set clerk_invitation_id = coalesce(excluded.clerk_invitation_id, mediasis.business_invitations.clerk_invitation_id),
      updated_at = now()
  returning * into v_invitation;

  return jsonb_build_object(
    'success', true,
    'business_invitation_id', v_invitation.business_invitation_id,
    'correlation_id', v_invitation.correlation_id,
    'status', v_invitation.status
  );
end;
$$;

create or replace function mediasis.accept_business_invitation(
  p_correlation_id uuid,
  p_clerk_user_id text,
  p_verified_email text,
  p_clerk_membership_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation mediasis.business_invitations%rowtype;
  v_app_user mediasis.app_users%rowtype;
  v_membership mediasis.business_memberships%rowtype;
  v_location_id uuid;
begin
  select * into v_invitation
  from mediasis.business_invitations bi
  where bi.correlation_id = p_correlation_id
  for update;

  if not found then raise exception 'Business invitation not found'; end if;
  if v_invitation.status = 'accepted' then
    return jsonb_build_object('success', true, 'duplicate', true, 'business_id', v_invitation.business_id);
  end if;
  if v_invitation.status <> 'pending' or v_invitation.expires_at <= now() then
    raise exception 'Business invitation is no longer active';
  end if;
  if lower(pg_catalog.btrim(p_verified_email)) <> v_invitation.invited_email then
    raise exception 'The verified Clerk email does not match the invitation';
  end if;

  select * into v_app_user
  from mediasis.app_users au
  where au.clerk_user_id = p_clerk_user_id
  for update;

  if not found then
    insert into mediasis.app_users (clerk_user_id, primary_email, status)
    values (p_clerk_user_id, lower(pg_catalog.btrim(p_verified_email)), 'active')
    returning * into v_app_user;
  elsif v_app_user.status <> 'active' or v_app_user.deleted_at is not null then
    raise exception 'The Mediasis identity is not active';
  end if;

  -- Explicit location grants and all_locations are mutually exclusive. Revoke
  -- the old grants before changing the membership scope so the foundation
  -- constraint trigger sees one coherent authorization state.
  update mediasis.business_membership_locations
  set revoked_at = coalesce(revoked_at, now()), updated_at = now()
  where business_membership_id in (
    select bm.business_membership_id
    from mediasis.business_memberships bm
    where bm.business_id = v_invitation.business_id
      and bm.app_user_id = v_app_user.app_user_id
  ) and revoked_at is null;

  insert into mediasis.business_memberships (
    business_id, app_user_id, clerk_membership_id, status, revoked_at, all_locations
  ) values (
    v_invitation.business_id, v_app_user.app_user_id,
    nullif(pg_catalog.btrim(p_clerk_membership_id), ''), 'active', null,
    v_invitation.all_locations
  )
  on conflict (business_id, app_user_id) do update
  set clerk_membership_id = coalesce(excluded.clerk_membership_id, mediasis.business_memberships.clerk_membership_id),
      status = 'active', revoked_at = null, all_locations = excluded.all_locations,
      updated_at = now()
  returning * into v_membership;

  -- An accepted invitation defines the complete intended role set for this
  -- membership. Old assignments must not silently survive re-invitation.
  update mediasis.business_membership_roles
  set revoked_at = coalesce(revoked_at, now())
  where business_membership_id = v_membership.business_membership_id
    and revoked_at is null;

  insert into mediasis.business_membership_roles (
    business_membership_id, business_role_id, business_id, revoked_at
  ) values (
    v_membership.business_membership_id, v_invitation.business_role_id,
    v_invitation.business_id, null
  )
  on conflict (business_membership_id, business_role_id) do update set revoked_at = null;

  if not v_invitation.all_locations then
    for v_location_id in select unnest(v_invitation.location_ids)
    loop
      insert into mediasis.business_membership_locations (
        business_membership_id, business_location_id, business_id, revoked_at
      ) values (
        v_membership.business_membership_id, v_location_id, v_invitation.business_id, null
      )
      on conflict (business_membership_id, business_location_id) do update set revoked_at = null;
    end loop;
  end if;

  update mediasis.business_invitations
  set status = 'accepted', accepted_by_app_user_id = v_app_user.app_user_id,
      accepted_at = now(), updated_at = now(), last_error = null
  where business_invitation_id = v_invitation.business_invitation_id;

  return jsonb_build_object(
    'success', true,
    'business_id', v_invitation.business_id,
    'app_user_id', v_app_user.app_user_id,
    'business_membership_id', v_membership.business_membership_id
  );
end;
$$;

create or replace function mediasis.update_clerk_business_invitation_status(
  p_clerk_invitation_id text,
  p_status text,
  p_last_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation_id uuid;
begin
  if p_status not in ('pending', 'accepted', 'revoked', 'expired', 'failed') then
    raise exception 'Invalid business invitation status';
  end if;

  update mediasis.business_invitations
  set status = p_status,
      revoked_at = case when p_status = 'revoked' then coalesce(revoked_at, now()) else revoked_at end,
      last_error = p_last_error,
      updated_at = now()
  where clerk_invitation_id = p_clerk_invitation_id
  returning business_invitation_id into v_invitation_id;

  return jsonb_build_object(
    'success', true,
    'matched', v_invitation_id is not null,
    'business_invitation_id', v_invitation_id
  );
end;
$$;

create or replace function mediasis.sync_clerk_organization_membership(
  p_clerk_organization_id text,
  p_clerk_user_id text,
  p_clerk_membership_id text,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_app_user_id uuid;
  v_membership_id uuid;
begin
  select b.uid into v_business_id
  from mediasis.businesses b
  where b.clerk_organization_id = p_clerk_organization_id;
  if v_business_id is null then
    return jsonb_build_object('success', true, 'ignored', true, 'reason', 'organization_not_mapped');
  end if;

  select au.app_user_id into v_app_user_id
  from mediasis.app_users au
  where au.clerk_user_id = p_clerk_user_id and au.status = 'active';
  if v_app_user_id is null then
    return jsonb_build_object('success', true, 'ignored', true, 'reason', 'identity_not_synchronized');
  end if;

  select bm.business_membership_id into v_membership_id
  from mediasis.business_memberships bm
  where bm.business_id = v_business_id and bm.app_user_id = v_app_user_id
  for update;
  if v_membership_id is null then
    return jsonb_build_object('success', true, 'ignored', true, 'reason', 'no_mediasis_membership');
  end if;

  update mediasis.business_memberships
  set clerk_membership_id = coalesce(nullif(pg_catalog.btrim(p_clerk_membership_id), ''), clerk_membership_id),
      status = case when p_active then 'active' else 'revoked' end,
      revoked_at = case when p_active then null else coalesce(revoked_at, now()) end,
      updated_at = now()
  where business_membership_id = v_membership_id;

  return jsonb_build_object('success', true, 'business_id', v_business_id, 'business_membership_id', v_membership_id);
end;
$$;

create or replace function mediasis.handle_clerk_organization_deleted(
  p_clerk_organization_id text,
  p_deleted_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select b.uid into v_business_id
  from mediasis.businesses b
  where b.clerk_organization_id = p_clerk_organization_id;
  if v_business_id is null then
    return jsonb_build_object('success', true, 'ignored', true);
  end if;

  update mediasis.business_memberships
  set status = 'revoked', revoked_at = coalesce(revoked_at, p_deleted_at), updated_at = now()
  where business_id = v_business_id and status <> 'revoked';

  return jsonb_build_object('success', true, 'business_id', v_business_id);
end;
$$;

revoke all on table mediasis.business_invitations from public, anon, authenticated;
revoke all on function mediasis.map_clerk_organization_to_business(uuid, text) from public, anon, authenticated;
revoke all on function mediasis.register_business_invitation(uuid, text, uuid, boolean, uuid[], uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function mediasis.accept_business_invitation(uuid, text, text, text) from public, anon, authenticated;
revoke all on function mediasis.update_clerk_business_invitation_status(text, text, text) from public, anon, authenticated;
revoke all on function mediasis.sync_clerk_organization_membership(text, text, text, boolean) from public, anon, authenticated;
revoke all on function mediasis.handle_clerk_organization_deleted(text, timestamptz) from public, anon, authenticated;
grant execute on function mediasis.register_business_invitation(uuid, text, uuid, boolean, uuid[], uuid, uuid, text, timestamptz) to service_role;
grant execute on function mediasis.map_clerk_organization_to_business(uuid, text) to service_role;
grant execute on function mediasis.accept_business_invitation(uuid, text, text, text) to service_role;
grant execute on function mediasis.update_clerk_business_invitation_status(text, text, text) to service_role;
grant execute on function mediasis.sync_clerk_organization_membership(text, text, text, boolean) to service_role;
grant execute on function mediasis.handle_clerk_organization_deleted(text, timestamptz) to service_role;

commit;
