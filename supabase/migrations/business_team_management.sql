-- Migration: 041
-- Business team management for Clerk-enabled dashboard accounts.
-- Depends on 001-007 and 036-040. Review and apply before deploying the UI.

begin;

alter table mediasis.business_invitations
  add column if not exists provisioning_mode text not null default 'invitation',
  add column if not exists display_name text,
  add column if not exists clerk_user_id text,
  add column if not exists clerk_membership_id text;

-- Earlier invitation reconciliation functions already update this timestamp;
-- add it to the foundation table before those paths are exercised.
alter table mediasis.business_membership_locations
  add column if not exists updated_at timestamptz not null default now();

-- Active membership grants use composite foreign keys with ON UPDATE CASCADE.
-- Invitation scopes are UUID arrays and therefore cannot use a foreign key;
-- keep those arrays synchronized explicitly when an existing location ID is
-- legitimately replaced.
create or replace function mediasis.cascade_business_location_id_to_team_scopes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.business_location_id is distinct from old.business_location_id then
    update mediasis.business_invitations bi
    set location_ids = pg_catalog.array_replace(
          bi.location_ids,
          old.business_location_id,
          new.business_location_id
        ),
        updated_at = now()
    where bi.business_id = new.business_uid
      and old.business_location_id = any(bi.location_ids);
  end if;
  return new;
end;
$$;

drop trigger if exists business_location_cascade_team_scopes
  on mediasis.business_location;
create trigger business_location_cascade_team_scopes
after update of business_location_id on mediasis.business_location
for each row
when (old.business_location_id is distinct from new.business_location_id)
execute function mediasis.cascade_business_location_id_to_team_scopes();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'mediasis.business_invitations'::regclass
      and conname = 'business_invitations_mode_valid'
  ) then
    alter table mediasis.business_invitations
      add constraint business_invitations_mode_valid
      check (provisioning_mode in ('invitation', 'reserved'));
  end if;
end
$$;

create index if not exists business_invitations_correlation_business_idx
  on mediasis.business_invitations(correlation_id, business_id);

create table if not exists mediasis.business_authorization_incidents (
  business_authorization_incident_id bigint generated always as identity primary key,
  business_id uuid not null references mediasis.businesses(uid)
    on update cascade on delete restrict,
  incident_type text not null,
  clerk_event_id text,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint business_authorization_incidents_type_not_blank
    check (pg_catalog.btrim(incident_type) <> '')
);

create unique index if not exists business_authorization_incidents_clerk_event_unique
  on mediasis.business_authorization_incidents(clerk_event_id, incident_type)
  where clerk_event_id is not null;

alter table mediasis.business_authorization_incidents enable row level security;
revoke all on table mediasis.business_authorization_incidents from public, anon, authenticated;

drop trigger if exists business_invitations_prevent_physical_delete
  on mediasis.business_invitations;
create trigger business_invitations_prevent_physical_delete
before delete on mediasis.business_invitations
for each row execute function mediasis.prevent_authorization_physical_delete();

drop trigger if exists business_authorization_incidents_prevent_physical_delete
  on mediasis.business_authorization_incidents;
create trigger business_authorization_incidents_prevent_physical_delete
before delete on mediasis.business_authorization_incidents
for each row execute function mediasis.prevent_authorization_physical_delete();

create or replace function mediasis.team_actor_has_permission(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_permission_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from mediasis.app_users au
    join mediasis.business_memberships bm on bm.app_user_id = au.app_user_id
    join mediasis.business_membership_roles bmr
      on bmr.business_membership_id = bm.business_membership_id
     and bmr.business_id = bm.business_id
     and bmr.revoked_at is null
    join mediasis.business_roles br
      on br.business_role_id = bmr.business_role_id
     and br.business_id = bm.business_id
     and br.active and br.archived_at is null
    join mediasis.business_role_permissions brp
      on brp.business_role_id = br.business_role_id
     and brp.revoked_at is null
    join mediasis.business_permissions bp
      on bp.permission_key = brp.permission_key
     and bp.active and bp.archived_at is null
    where au.app_user_id = p_actor_app_user_id
      and au.status = 'active' and au.deleted_at is null
      and bm.business_id = p_business_id
      and bm.status = 'active' and bm.revoked_at is null
      and bp.permission_key = p_permission_key
  );
$$;

create or replace function mediasis.team_require_permission(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_permission_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not mediasis.team_actor_has_permission(
    p_business_id, p_actor_app_user_id, p_permission_key
  ) then
    raise exception 'You do not have permission to perform this team operation';
  end if;
end;
$$;

create or replace function mediasis.team_validate_role_assignment(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_role_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_key text;
begin
  select br.role_key into v_role_key
  from mediasis.business_roles br
  where br.business_role_id = p_business_role_id
    and br.business_id = p_business_id
    and br.active and br.archived_at is null;
  if v_role_key is null then raise exception 'The selected role is unavailable'; end if;

  if exists (
    select 1
    from mediasis.business_role_permissions brp
    join mediasis.business_permissions bp on bp.permission_key = brp.permission_key
    where brp.business_role_id = p_business_role_id
      and brp.revoked_at is null
      and bp.active and bp.archived_at is null
      and not mediasis.team_actor_has_permission(
        p_business_id, p_actor_app_user_id, brp.permission_key
      )
  ) then
    raise exception 'You cannot assign a role containing permissions you do not hold';
  end if;
  return v_role_key;
end;
$$;

create or replace function mediasis.team_validate_location_scope(
  p_business_id uuid,
  p_all_locations boolean,
  p_location_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_all_locations, false) then
    if cardinality(coalesce(p_location_ids, '{}'::uuid[])) <> 0 then
      raise exception 'All-location access cannot include explicit location grants';
    end if;
    return;
  end if;
  if cardinality(coalesce(p_location_ids, '{}'::uuid[])) = 0 then
    raise exception 'Select at least one business location';
  end if;
  if exists (
    select 1
    from unnest(p_location_ids) requested(location_id)
    left join mediasis.business_location bl
      on bl.business_location_id = requested.location_id
     and bl.business_uid = p_business_id
    where bl.business_location_id is null
  ) then
    raise exception 'One or more locations do not belong to this business';
  end if;
end;
$$;

create or replace function mediasis.team_validate_actor_location_grant(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_all_locations boolean,
  p_location_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor_all_locations boolean;
begin
  select bm.all_locations into v_actor_all_locations
  from mediasis.business_memberships bm
  where bm.business_id = p_business_id
    and bm.app_user_id = p_actor_app_user_id
    and bm.status = 'active' and bm.revoked_at is null;
  if not found then raise exception 'Active actor membership not found'; end if;
  if v_actor_all_locations then return; end if;
  if p_all_locations then raise exception 'You cannot grant all-location access'; end if;
  if exists (
    select 1
    from unnest(coalesce(p_location_ids, '{}'::uuid[])) requested(location_id)
    left join mediasis.business_membership_locations bml
      on bml.business_location_id = requested.location_id
     and bml.business_id = p_business_id
     and bml.business_membership_id = (
       select bm.business_membership_id
       from mediasis.business_memberships bm
       where bm.business_id = p_business_id
         and bm.app_user_id = p_actor_app_user_id
         and bm.status = 'active' and bm.revoked_at is null
     )
     and bml.revoked_at is null
    where bml.business_location_id is null
  ) then
    raise exception 'You cannot grant a location you do not have';
  end if;
end;
$$;

create or replace function mediasis.get_business_team_management(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_members jsonb;
  v_invitations jsonb;
  v_roles jsonb;
  v_permissions jsonb;
  v_actor_permissions jsonb;
  v_locations jsonb;
begin
  perform mediasis.team_require_permission(
    p_business_id, p_actor_app_user_id, 'members.read'
  );

  select coalesce(jsonb_agg(row_data order by row_data->>'email'), '[]'::jsonb)
  into v_members
  from (
    select jsonb_build_object(
      'membership_id', bm.business_membership_id,
      'app_user_id', au.app_user_id,
      'name', coalesce(nullif(au.display_name, ''), au.primary_email, 'Usuario Mediasis'),
      'email', au.primary_email,
      'avatar_url', au.avatar_url,
      'status', bm.status,
      'all_locations', bm.all_locations,
      'clerk_membership_id', bm.clerk_membership_id,
      'role_id', br.business_role_id,
      'role_key', br.role_key,
      'role_name', case when br.role_key = 'business_full_access'
        then 'Acceso completo' else br.name end,
      'location_ids', coalesce((
        select jsonb_agg(bml.business_location_id order by bml.business_location_id)
        from mediasis.business_membership_locations bml
        where bml.business_membership_id = bm.business_membership_id
          and bml.revoked_at is null
      ), '[]'::jsonb),
      'created_at', bm.created_at
    ) as row_data
    from mediasis.business_memberships bm
    join mediasis.app_users au on au.app_user_id = bm.app_user_id
    left join lateral (
      select br.*
      from mediasis.business_membership_roles bmr
      join mediasis.business_roles br on br.business_role_id = bmr.business_role_id
      where bmr.business_membership_id = bm.business_membership_id
        and bmr.revoked_at is null
      order by br.role_key = 'business_full_access' desc, br.created_at
      limit 1
    ) br on true
    where bm.business_id = p_business_id and bm.status <> 'revoked'
  ) rows;

  select coalesce(jsonb_agg(row_data order by row_data->>'email'), '[]'::jsonb)
  into v_invitations
  from (
    select jsonb_build_object(
      'invitation_id', bi.business_invitation_id,
      'correlation_id', bi.correlation_id,
      'email', bi.invited_email,
      'display_name', bi.display_name,
      'mode', bi.provisioning_mode,
      'status', bi.status,
      'role_id', bi.business_role_id,
      'role_name', case when br.role_key = 'business_full_access'
        then 'Acceso completo' else br.name end,
      'all_locations', bi.all_locations,
      'location_ids', to_jsonb(bi.location_ids),
      'expires_at', bi.expires_at,
      'last_error', bi.last_error
    ) as row_data
    from mediasis.business_invitations bi
    join mediasis.business_roles br on br.business_role_id = bi.business_role_id
    where bi.business_id = p_business_id
      and bi.status in ('pending', 'failed')
  ) rows;

  select coalesce(jsonb_agg(row_data order by row_data->>'name'), '[]'::jsonb)
  into v_roles
  from (
    select jsonb_build_object(
      'role_id', br.business_role_id,
      'role_key', br.role_key,
      'name', case when br.role_key = 'business_full_access'
        then 'Acceso completo' else br.name end,
      'description', case when br.role_key = 'business_full_access'
        then 'Rol protegido administrado por Mediasis con todos los permisos activos del negocio.'
        else br.description end,
      'origin', br.role_origin,
      'editable', br.is_editable,
      'permission_keys', coalesce((
        select jsonb_agg(brp.permission_key order by brp.permission_key)
        from mediasis.business_role_permissions brp
        where brp.business_role_id = br.business_role_id
          and brp.revoked_at is null
          and brp.permission_key in (
            'analytics.read', 'members.read', 'members.invite',
            'members.change_role', 'members.change_location_access',
            'members.remove', 'roles.read', 'roles.manage'
          )
      ), '[]'::jsonb)
    ) as row_data
    from mediasis.business_roles br
    where br.business_id = p_business_id
      and br.active and br.archived_at is null
  ) rows;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', bp.permission_key,
    'name', case bp.permission_key
      when 'analytics.read' then 'Ver analíticas'
      when 'members.read' then 'Ver usuarios'
      when 'members.invite' then 'Invitar usuarios'
      when 'members.change_role' then 'Cambiar roles de usuarios'
      when 'members.change_location_access' then 'Cambiar acceso a ubicaciones'
      when 'members.remove' then 'Suspender o eliminar usuarios'
      when 'roles.read' then 'Ver roles'
      when 'roles.manage' then 'Administrar roles'
      else bp.name
    end,
    'description', bp.description
  ) order by bp.permission_key), '[]'::jsonb)
  into v_permissions
  from mediasis.business_permissions bp
  where bp.active and bp.archived_at is null
    and bp.permission_key in (
      'analytics.read', 'members.read', 'members.invite',
      'members.change_role', 'members.change_location_access',
      'members.remove', 'roles.read', 'roles.manage'
    );

  select coalesce(jsonb_agg(bp.permission_key order by bp.permission_key), '[]'::jsonb)
  into v_actor_permissions
  from mediasis.business_permissions bp
  where bp.active and mediasis.team_actor_has_permission(
    p_business_id, p_actor_app_user_id, bp.permission_key
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'location_id', bl.business_location_id,
    'name', bl.short_name
  ) order by bl.short_name), '[]'::jsonb)
  into v_locations
  from mediasis.business_location bl
  where bl.business_uid = p_business_id;

  return jsonb_build_object(
    'success', true,
    'members', v_members,
    'invitations', v_invitations,
    'roles', v_roles,
    'permissions', v_permissions,
    'actor_permissions', v_actor_permissions,
    'locations', v_locations
  );
end;
$$;

create or replace function mediasis.prepare_business_member_provisioning(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_email text,
  p_display_name text,
  p_mode text,
  p_business_role_id uuid,
  p_all_locations boolean,
  p_location_ids uuid[],
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(pg_catalog.btrim(p_email));
  v_role_key text;
  v_invitation mediasis.business_invitations%rowtype;
begin
  perform mediasis.team_require_permission(
    p_business_id, p_actor_app_user_id, 'members.invite'
  );
  if p_mode not in ('invitation', 'reserved') then raise exception 'Invalid provisioning mode'; end if;
  if v_email = '' or v_email not like '%@%' then raise exception 'Enter a valid email'; end if;
  if p_mode = 'reserved' and nullif(pg_catalog.btrim(p_display_name), '') is null then
    raise exception 'A display name is required for reserved users';
  end if;

  v_role_key := mediasis.team_validate_role_assignment(
    p_business_id, p_actor_app_user_id, p_business_role_id
  );
  if v_role_key = 'business_full_access' then
    perform mediasis.team_validate_location_scope(p_business_id, true, '{}'::uuid[]);
    p_all_locations := true;
    p_location_ids := '{}'::uuid[];
  else
    perform mediasis.team_validate_location_scope(
      p_business_id, p_all_locations, p_location_ids
    );
  end if;
  perform mediasis.team_validate_actor_location_grant(
    p_business_id, p_actor_app_user_id, p_all_locations, p_location_ids
  );

  if exists (
    select 1
    from mediasis.app_users au
    join mediasis.business_memberships bm on bm.app_user_id = au.app_user_id
    where lower(au.primary_email) = v_email
      and bm.business_id = p_business_id
      and bm.status <> 'revoked'
  ) then raise exception 'This email already belongs to the business'; end if;

  if exists (
    select 1 from mediasis.business_invitations bi
    where bi.business_id = p_business_id
      and bi.invited_email = v_email
      and bi.status = 'pending'
      and bi.correlation_id <> p_correlation_id
  ) then raise exception 'This email already has a pending invitation'; end if;

  insert into mediasis.business_invitations (
    business_id, invited_email, display_name, provisioning_mode,
    business_role_id, all_locations, location_ids,
    invited_by_app_user_id, correlation_id, expires_at
  ) values (
    p_business_id, v_email, nullif(pg_catalog.btrim(p_display_name), ''), p_mode,
    p_business_role_id, p_all_locations,
    case when p_all_locations then '{}'::uuid[] else p_location_ids end,
    p_actor_app_user_id, p_correlation_id, now() + interval '30 days'
  )
  on conflict (correlation_id) do update set updated_at = now()
  returning * into v_invitation;

  return jsonb_build_object(
    'success', true,
    'correlation_id', v_invitation.correlation_id,
    'email', v_invitation.invited_email,
    'mode', v_invitation.provisioning_mode,
    'status', v_invitation.status
  );
end;
$$;

create or replace function mediasis.record_business_member_external_ids(
  p_business_id uuid,
  p_correlation_id uuid,
  p_clerk_invitation_id text default null,
  p_clerk_user_id text default null,
  p_clerk_membership_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  update mediasis.business_invitations
  set clerk_invitation_id = coalesce(nullif(pg_catalog.btrim(p_clerk_invitation_id), ''), clerk_invitation_id),
      clerk_user_id = coalesce(nullif(pg_catalog.btrim(p_clerk_user_id), ''), clerk_user_id),
      clerk_membership_id = coalesce(nullif(pg_catalog.btrim(p_clerk_membership_id), ''), clerk_membership_id),
      status = case
        when p_error is null and status = 'failed' then 'pending'
        when p_error is null then status
        else 'failed'
      end,
      failed_at = case when p_error is null then null else now() end,
      last_error = p_error,
      updated_at = now()
  where business_id = p_business_id and correlation_id = p_correlation_id
  returning business_invitation_id into v_id;
  if v_id is null then raise exception 'Provisioning record not found'; end if;
  return jsonb_build_object('success', true, 'business_invitation_id', v_id);
end;
$$;

create or replace function mediasis.finalize_reserved_business_member(
  p_business_id uuid,
  p_correlation_id uuid,
  p_clerk_user_id text,
  p_clerk_membership_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation mediasis.business_invitations%rowtype;
  v_app_user_id uuid;
  v_email_user_id uuid;
  v_membership_id uuid;
  v_location_id uuid;
begin
  select * into v_invitation
  from mediasis.business_invitations bi
  where bi.business_id = p_business_id and bi.correlation_id = p_correlation_id
  for update;
  if not found or v_invitation.provisioning_mode <> 'reserved' then
    raise exception 'Reserved provisioning record not found';
  end if;
  if v_invitation.status = 'accepted' then
    return jsonb_build_object('success', true, 'duplicate', true);
  end if;
  if v_invitation.status not in ('pending', 'failed') then
    raise exception 'Reserved provisioning is no longer active';
  end if;

  select au.app_user_id into v_app_user_id
  from mediasis.app_users au where au.clerk_user_id = p_clerk_user_id for update;
  select au.app_user_id into v_email_user_id
  from mediasis.app_users au
  where lower(au.primary_email) = v_invitation.invited_email
    and au.status <> 'deleted' for update;
  if v_email_user_id is not null and v_email_user_id is distinct from v_app_user_id then
    raise exception 'The reserved email already belongs to another Mediasis identity';
  end if;

  if v_app_user_id is null then
    insert into mediasis.app_users (
      clerk_user_id, primary_email, display_name, status, deleted_at
    ) values (
      p_clerk_user_id, v_invitation.invited_email,
      v_invitation.display_name, 'active', null
    ) returning app_user_id into v_app_user_id;
  else
    update mediasis.app_users
    set display_name = coalesce(nullif(display_name, ''), v_invitation.display_name),
        status = 'active', deleted_at = null, updated_at = now()
    where app_user_id = v_app_user_id;
  end if;

  insert into mediasis.business_memberships (
    business_id, app_user_id, clerk_membership_id, status, revoked_at, all_locations
  ) values (
    p_business_id, v_app_user_id, p_clerk_membership_id,
    'active', null, v_invitation.all_locations
  )
  on conflict (business_id, app_user_id) do update
  set clerk_membership_id = excluded.clerk_membership_id,
      status = 'active', revoked_at = null,
      all_locations = excluded.all_locations, updated_at = now()
  returning business_membership_id into v_membership_id;

  update mediasis.business_membership_roles set revoked_at = coalesce(revoked_at, now())
  where business_membership_id = v_membership_id and revoked_at is null;
  insert into mediasis.business_membership_roles (
    business_membership_id, business_role_id, business_id, revoked_at
  ) values (
    v_membership_id, v_invitation.business_role_id, p_business_id, null
  ) on conflict (business_membership_id, business_role_id)
    do update set revoked_at = null;

  update mediasis.business_membership_locations
  set revoked_at = coalesce(revoked_at, now()), updated_at = now()
  where business_membership_id = v_membership_id and revoked_at is null;
  if not v_invitation.all_locations then
    foreach v_location_id in array v_invitation.location_ids loop
      insert into mediasis.business_membership_locations (
        business_membership_id, business_location_id, business_id, revoked_at
      ) values (v_membership_id, v_location_id, p_business_id, null)
      on conflict (business_membership_id, business_location_id)
      do update set revoked_at = null, updated_at = now();
    end loop;
  end if;

  update mediasis.business_invitations
  set status = 'accepted', accepted_by_app_user_id = v_app_user_id,
      accepted_at = now(), clerk_user_id = p_clerk_user_id,
      clerk_membership_id = p_clerk_membership_id,
      failed_at = null, last_error = null, updated_at = now()
  where business_invitation_id = v_invitation.business_invitation_id;

  insert into mediasis.authorization_audit_log (
    actor_app_user_id, subject_app_user_id, business_id, action,
    target_type, target_id, after_value, request_id
  ) values (
    v_invitation.invited_by_app_user_id, v_app_user_id, p_business_id,
    'business_member.reserved_created', 'business_membership', v_membership_id::text,
    jsonb_build_object('role_id', v_invitation.business_role_id,
      'all_locations', v_invitation.all_locations), p_correlation_id::text
  );
  return jsonb_build_object(
    'success', true, 'app_user_id', v_app_user_id,
    'business_membership_id', v_membership_id
  );
end;
$$;

create or replace function mediasis.create_business_custom_role(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_name text,
  p_description text,
  p_permission_keys text[],
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_key text := 'custom_' || replace(p_idempotency_key::text, '-', '');
  v_permission text;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'roles.manage');
  if nullif(pg_catalog.btrim(p_name), '') is null then raise exception 'Role name is required'; end if;
  if cardinality(coalesce(p_permission_keys, '{}'::text[])) = 0 then raise exception 'Select at least one permission'; end if;

  foreach v_permission in array p_permission_keys loop
    if v_permission not in (
      'analytics.read', 'members.read', 'members.invite',
      'members.change_role', 'members.change_location_access',
      'members.remove', 'roles.read', 'roles.manage'
    ) or not mediasis.team_actor_has_permission(p_business_id, p_actor_app_user_id, v_permission) then
      raise exception 'You cannot grant permission %', v_permission;
    end if;
  end loop;

  insert into mediasis.business_roles (
    business_id, role_key, name, description, role_origin, is_editable
  ) values (
    p_business_id, v_key, pg_catalog.btrim(p_name),
    nullif(pg_catalog.btrim(p_description), ''), 'custom', true
  ) on conflict (business_id, role_key) do update set updated_at = now()
  returning business_role_id into v_role_id;

  foreach v_permission in array p_permission_keys loop
    insert into mediasis.business_role_permissions (
      business_role_id, permission_key, revoked_at
    ) values (v_role_id, v_permission, null)
    on conflict (business_role_id, permission_key) do update set revoked_at = null;
  end loop;
  return jsonb_build_object('success', true, 'role_id', v_role_id);
end;
$$;

create or replace function mediasis.update_business_custom_role(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_role_id uuid,
  p_name text,
  p_description text,
  p_permission_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_permission text;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'roles.manage');
  perform 1 from mediasis.business_roles br
  where br.business_role_id = p_business_role_id and br.business_id = p_business_id
    and br.role_origin = 'custom' and br.is_editable and br.active
  for update;
  if not found then raise exception 'Only active custom roles can be edited'; end if;
  if nullif(pg_catalog.btrim(p_name), '') is null then raise exception 'Role name is required'; end if;
  if cardinality(coalesce(p_permission_keys, '{}'::text[])) = 0 then raise exception 'Select at least one permission'; end if;
  foreach v_permission in array p_permission_keys loop
    if v_permission not in (
      'analytics.read', 'members.read', 'members.invite',
      'members.change_role', 'members.change_location_access',
      'members.remove', 'roles.read', 'roles.manage'
    ) or not mediasis.team_actor_has_permission(p_business_id, p_actor_app_user_id, v_permission) then
      raise exception 'You cannot grant permission %', v_permission;
    end if;
  end loop;

  update mediasis.business_roles set name = pg_catalog.btrim(p_name),
    description = nullif(pg_catalog.btrim(p_description), ''), updated_at = now()
  where business_role_id = p_business_role_id;
  update mediasis.business_role_permissions set revoked_at = coalesce(revoked_at, now())
  where business_role_id = p_business_role_id and revoked_at is null;
  foreach v_permission in array p_permission_keys loop
    insert into mediasis.business_role_permissions (business_role_id, permission_key, revoked_at)
    values (p_business_role_id, v_permission, null)
    on conflict (business_role_id, permission_key) do update set revoked_at = null;
  end loop;
  return jsonb_build_object('success', true, 'role_id', p_business_role_id);
end;
$$;

create or replace function mediasis.archive_business_custom_role(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_role_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'roles.manage');
  perform 1 from mediasis.business_roles br
  where br.business_role_id = p_business_role_id and br.business_id = p_business_id
    and br.role_origin = 'custom' and br.is_editable and br.active for update;
  if not found then raise exception 'Only active custom roles can be archived'; end if;
  if exists (
    select 1 from mediasis.business_membership_roles bmr
    join mediasis.business_memberships bm on bm.business_membership_id = bmr.business_membership_id
    where bmr.business_role_id = p_business_role_id and bmr.revoked_at is null
      and bm.status = 'active' and bm.revoked_at is null
  ) then raise exception 'Reassign active members before archiving this role'; end if;
  update mediasis.business_roles set active = false, archived_at = now(), updated_at = now()
  where business_role_id = p_business_role_id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function mediasis.update_business_member_access(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_membership_id uuid,
  p_business_role_id uuid,
  p_all_locations boolean,
  p_location_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership mediasis.business_memberships%rowtype;
  v_old_role_id uuid;
  v_old_role_key text;
  v_new_role_key text;
  v_location_id uuid;
  v_admin_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text, 0));
  select * into v_membership from mediasis.business_memberships bm
  where bm.business_membership_id = p_business_membership_id
    and bm.business_id = p_business_id for update;
  if not found or v_membership.status = 'revoked' then raise exception 'Member not found'; end if;
  select br.business_role_id, br.role_key into v_old_role_id, v_old_role_key
  from mediasis.business_membership_roles bmr
  join mediasis.business_roles br on br.business_role_id = bmr.business_role_id
  where bmr.business_membership_id = p_business_membership_id and bmr.revoked_at is null
  order by br.role_key = 'business_full_access' desc limit 1;

  if v_old_role_id is distinct from p_business_role_id then
    perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.change_role');
  end if;
  if v_membership.all_locations is distinct from p_all_locations
    or (not p_all_locations and (
      (select coalesce(array_agg(x order by x), '{}'::uuid[])
       from unnest(coalesce(p_location_ids, '{}'::uuid[])) x)
      is distinct from
      (select coalesce(array_agg(bml.business_location_id order by bml.business_location_id), '{}'::uuid[])
       from mediasis.business_membership_locations bml
       where bml.business_membership_id = p_business_membership_id
         and bml.revoked_at is null)
    )) then
    perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.change_location_access');
  end if;

  v_new_role_key := mediasis.team_validate_role_assignment(
    p_business_id, p_actor_app_user_id, p_business_role_id
  );
  if v_new_role_key = 'business_full_access' then
    p_all_locations := true; p_location_ids := '{}'::uuid[];
  else
    perform mediasis.team_validate_location_scope(p_business_id, p_all_locations, p_location_ids);
  end if;
  perform mediasis.team_validate_actor_location_grant(
    p_business_id, p_actor_app_user_id, p_all_locations, p_location_ids
  );

  if v_old_role_key = 'business_full_access'
    and (v_new_role_key <> 'business_full_access' or not p_all_locations) then
    select count(*) into v_admin_count
    from mediasis.business_memberships bm
    join mediasis.business_membership_roles bmr on bmr.business_membership_id = bm.business_membership_id
      and bmr.revoked_at is null
    join mediasis.business_roles br on br.business_role_id = bmr.business_role_id
    where bm.business_id = p_business_id and bm.status = 'active' and bm.revoked_at is null
      and br.role_key = 'business_full_access' and br.active;
    if v_admin_count <= 1 then raise exception 'The business must retain at least one full-access administrator'; end if;
  end if;

  update mediasis.business_membership_locations set revoked_at = coalesce(revoked_at, now()), updated_at = now()
  where business_membership_id = p_business_membership_id and revoked_at is null;
  update mediasis.business_memberships set all_locations = p_all_locations, updated_at = now()
  where business_membership_id = p_business_membership_id;
  update mediasis.business_membership_roles set revoked_at = coalesce(revoked_at, now())
  where business_membership_id = p_business_membership_id and revoked_at is null;
  insert into mediasis.business_membership_roles (
    business_membership_id, business_role_id, business_id, revoked_at
  ) values (p_business_membership_id, p_business_role_id, p_business_id, null)
  on conflict (business_membership_id, business_role_id) do update set revoked_at = null;
  if not p_all_locations then
    foreach v_location_id in array p_location_ids loop
      insert into mediasis.business_membership_locations (
        business_membership_id, business_location_id, business_id, revoked_at
      ) values (p_business_membership_id, v_location_id, p_business_id, null)
      on conflict (business_membership_id, business_location_id)
      do update set revoked_at = null, updated_at = now();
    end loop;
  end if;
  insert into mediasis.authorization_audit_log (
    actor_app_user_id, subject_app_user_id, business_id, action,
    target_type, target_id, before_value, after_value
  ) values (
    p_actor_app_user_id, v_membership.app_user_id, p_business_id,
    'business_member.access_changed', 'business_membership', p_business_membership_id::text,
    jsonb_build_object('role_id', v_old_role_id, 'all_locations', v_membership.all_locations),
    jsonb_build_object('role_id', p_business_role_id, 'all_locations', p_all_locations,
      'location_ids', p_location_ids)
  );
  return jsonb_build_object('success', true);
end;
$$;

create or replace function mediasis.set_business_member_status(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_membership_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership mediasis.business_memberships%rowtype;
  v_is_admin boolean;
  v_admin_count integer;
begin
  if p_status not in ('active', 'suspended', 'revoked') then raise exception 'Invalid member status'; end if;
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.remove');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text, 0));
  select * into v_membership from mediasis.business_memberships bm
  where bm.business_membership_id = p_business_membership_id
    and bm.business_id = p_business_id for update;
  if not found then raise exception 'Member not found'; end if;
  select exists (
    select 1 from mediasis.business_membership_roles bmr
    join mediasis.business_roles br on br.business_role_id = bmr.business_role_id
    where bmr.business_membership_id = p_business_membership_id
      and bmr.revoked_at is null and br.role_key = 'business_full_access' and br.active
  ) into v_is_admin;
  if v_is_admin and v_membership.status = 'active' and p_status <> 'active' then
    select count(*) into v_admin_count
    from mediasis.business_memberships bm
    join mediasis.business_membership_roles bmr on bmr.business_membership_id = bm.business_membership_id
      and bmr.revoked_at is null
    join mediasis.business_roles br on br.business_role_id = bmr.business_role_id
    where bm.business_id = p_business_id and bm.status = 'active' and bm.revoked_at is null
      and br.role_key = 'business_full_access' and br.active;
    if v_admin_count <= 1 then raise exception 'The business must retain at least one full-access administrator'; end if;
  end if;
  update mediasis.business_memberships
  set status = p_status,
      revoked_at = case when p_status = 'revoked' then coalesce(revoked_at, now()) else null end,
      updated_at = now()
  where business_membership_id = p_business_membership_id;
  insert into mediasis.authorization_audit_log (
    actor_app_user_id, subject_app_user_id, business_id, action,
    target_type, target_id, before_value, after_value
  ) values (
    p_actor_app_user_id, v_membership.app_user_id, p_business_id,
    'business_member.status_changed', 'business_membership', p_business_membership_id::text,
    jsonb_build_object('status', v_membership.status), jsonb_build_object('status', p_status)
  );
  return jsonb_build_object(
    'success', true, 'clerk_membership_id', v_membership.clerk_membership_id,
    'clerk_user_id', (
      select au.clerk_user_id from mediasis.app_users au
      where au.app_user_id = v_membership.app_user_id
    )
  );
end;
$$;

create or replace function mediasis.cancel_business_member_invitation(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_clerk_invitation_id text;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.invite');
  update mediasis.business_invitations
  set status = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
  where business_invitation_id = p_business_invitation_id
    and business_id = p_business_id and status in ('pending', 'failed')
  returning clerk_invitation_id into v_clerk_invitation_id;
  if not found then raise exception 'Active invitation not found'; end if;
  return jsonb_build_object('success', true, 'clerk_invitation_id', v_clerk_invitation_id);
end;
$$;

create or replace function mediasis.record_business_authorization_incident(
  p_clerk_organization_id text,
  p_incident_type text,
  p_clerk_event_id text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_business_id uuid;
begin
  select b.uid into v_business_id from mediasis.businesses b
  where b.clerk_organization_id = p_clerk_organization_id;
  if v_business_id is null then return jsonb_build_object('success', true, 'ignored', true); end if;
  insert into mediasis.business_authorization_incidents (
    business_id, incident_type, clerk_event_id, details
  ) values (v_business_id, p_incident_type, p_clerk_event_id, coalesce(p_details, '{}'::jsonb))
  on conflict (clerk_event_id, incident_type) where clerk_event_id is not null
  do nothing;
  return jsonb_build_object('success', true, 'business_id', v_business_id);
end;
$$;

-- Internal helpers are callable only by their SECURITY DEFINER parents.
revoke all on function mediasis.team_actor_has_permission(uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function mediasis.cascade_business_location_id_to_team_scopes() from public, anon, authenticated, service_role;
revoke all on function mediasis.team_require_permission(uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function mediasis.team_validate_role_assignment(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function mediasis.team_validate_location_scope(uuid,boolean,uuid[]) from public, anon, authenticated, service_role;
revoke all on function mediasis.team_validate_actor_location_grant(uuid,uuid,boolean,uuid[]) from public, anon, authenticated, service_role;

revoke all on function mediasis.get_business_team_management(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.prepare_business_member_provisioning(uuid,uuid,text,text,text,uuid,boolean,uuid[],uuid) from public, anon, authenticated;
revoke all on function mediasis.record_business_member_external_ids(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function mediasis.finalize_reserved_business_member(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function mediasis.create_business_custom_role(uuid,uuid,text,text,text[],uuid) from public, anon, authenticated;
revoke all on function mediasis.update_business_custom_role(uuid,uuid,uuid,text,text,text[]) from public, anon, authenticated;
revoke all on function mediasis.archive_business_custom_role(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.update_business_member_access(uuid,uuid,uuid,uuid,boolean,uuid[]) from public, anon, authenticated;
revoke all on function mediasis.set_business_member_status(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function mediasis.cancel_business_member_invitation(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.record_business_authorization_incident(text,text,text,jsonb) from public, anon, authenticated;

grant execute on function mediasis.get_business_team_management(uuid,uuid) to service_role;
grant execute on function mediasis.prepare_business_member_provisioning(uuid,uuid,text,text,text,uuid,boolean,uuid[],uuid) to service_role;
grant execute on function mediasis.record_business_member_external_ids(uuid,uuid,text,text,text,text) to service_role;
grant execute on function mediasis.finalize_reserved_business_member(uuid,uuid,text,text) to service_role;
grant execute on function mediasis.create_business_custom_role(uuid,uuid,text,text,text[],uuid) to service_role;
grant execute on function mediasis.update_business_custom_role(uuid,uuid,uuid,text,text,text[]) to service_role;
grant execute on function mediasis.archive_business_custom_role(uuid,uuid,uuid) to service_role;
grant execute on function mediasis.update_business_member_access(uuid,uuid,uuid,uuid,boolean,uuid[]) to service_role;
grant execute on function mediasis.set_business_member_status(uuid,uuid,uuid,text) to service_role;
grant execute on function mediasis.cancel_business_member_invitation(uuid,uuid,uuid) to service_role;
grant execute on function mediasis.record_business_authorization_incident(text,text,text,jsonb) to service_role;

commit;

-- Rollback circuit breaker for this phase:
-- revoke execute on function mediasis.get_business_team_management(uuid,uuid) from service_role;
-- Revoke the other 041 service functions before removing UI access. Keep
-- membership, role, invitation, incident, and audit data for review.
