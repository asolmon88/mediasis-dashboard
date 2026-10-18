-- Migration: 059
-- Purpose: Prepare and reconcile the one-time legacy business migration to Clerk.

begin;

-- Some businesses predate the authorization foundation. Repair their protected
-- administrator role before creating memberships for their legacy owners.
insert into mediasis.business_roles (
  business_id, role_key, name, description, role_origin, is_editable,
  active, archived_at, updated_at
)
select
  b.uid, 'business_full_access', 'Full access',
  'Mediasis-managed role with every active business permission.',
  'system'::mediasis.business_role_origin, false, true, null, now()
from mediasis.businesses b
where coalesce(b.active, false)
on conflict (business_id, role_key) do update
set name = excluded.name,
    description = excluded.description,
    role_origin = excluded.role_origin,
    is_editable = false,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key, revoked_at)
select br.business_role_id, bp.permission_key, null
from mediasis.business_roles br
cross join mediasis.business_permissions bp
where br.business_id is not null
  and br.role_key = 'business_full_access'
  and br.active and br.archived_at is null
  and bp.active and bp.archived_at is null
on conflict (business_role_id, permission_key) do update
set revoked_at = null;

create table if not exists mediasis.legacy_business_clerk_migrations (
  business_id uuid primary key
    references mediasis.businesses(uid) on update cascade on delete restrict,
  legacy_email text,
  clerk_user_id text,
  clerk_organization_id text,
  clerk_membership_id text,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error_code text,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legacy_business_clerk_migrations_email_valid
    check (legacy_email is null or pg_catalog.btrim(legacy_email) <> ''),
  constraint legacy_business_clerk_migrations_status_valid
    check (status in (
      'pending', 'prepared', 'user_created', 'organization_created',
      'membership_created', 'completed', 'failed', 'conflict'
    )),
  constraint legacy_business_clerk_migrations_attempts_valid check (attempts >= 0),
  constraint legacy_business_clerk_migrations_user_valid
    check (clerk_user_id is null or pg_catalog.btrim(clerk_user_id) <> ''),
  constraint legacy_business_clerk_migrations_org_valid
    check (clerk_organization_id is null or pg_catalog.btrim(clerk_organization_id) <> ''),
  constraint legacy_business_clerk_migrations_membership_valid
    check (clerk_membership_id is null or pg_catalog.btrim(clerk_membership_id) <> '')
);

create unique index if not exists legacy_business_clerk_migrations_email_unique
  on mediasis.legacy_business_clerk_migrations(lower(legacy_email))
  where legacy_email is not null;
create unique index if not exists legacy_business_clerk_migrations_user_unique
  on mediasis.legacy_business_clerk_migrations(clerk_user_id)
  where clerk_user_id is not null;
create unique index if not exists legacy_business_clerk_migrations_org_unique
  on mediasis.legacy_business_clerk_migrations(clerk_organization_id)
  where clerk_organization_id is not null;
create unique index if not exists legacy_business_clerk_migrations_membership_unique
  on mediasis.legacy_business_clerk_migrations(clerk_membership_id)
  where clerk_membership_id is not null;

alter table mediasis.legacy_business_clerk_migrations enable row level security;
revoke all on table mediasis.legacy_business_clerk_migrations from public, anon, authenticated;

insert into mediasis.legacy_business_clerk_migrations (
  business_id, legacy_email, clerk_user_id, clerk_organization_id,
  clerk_membership_id, status, completed_at
)
select
  b.uid,
  lower(pg_catalog.btrim(u.email)),
  au.clerk_user_id,
  b.clerk_organization_id,
  bm.clerk_membership_id,
  case
    when b.clerk_organization_id is not null
      and au.clerk_user_id is not null
      and bm.clerk_membership_id is not null
      and bm.status = 'active' and bm.revoked_at is null and bm.all_locations
      and exists (
        select 1
        from mediasis.business_membership_roles bmr
        join mediasis.business_roles br
          on br.business_role_id = bmr.business_role_id
         and br.business_id = bmr.business_id
        where bmr.business_membership_id = bm.business_membership_id
          and bmr.revoked_at is null
          and br.role_key = 'business_full_access'
          and br.active and br.archived_at is null
      )
    then 'completed'
    else 'pending'
  end,
  case
    when b.clerk_organization_id is not null
      and au.clerk_user_id is not null
      and bm.clerk_membership_id is not null
      and bm.status = 'active' and bm.revoked_at is null and bm.all_locations
      and exists (
        select 1
        from mediasis.business_membership_roles bmr
        join mediasis.business_roles br
          on br.business_role_id = bmr.business_role_id
         and br.business_id = bmr.business_id
        where bmr.business_membership_id = bm.business_membership_id
          and bmr.revoked_at is null
          and br.role_key = 'business_full_access'
          and br.active and br.archived_at is null
      )
    then now()
    else null
  end
from mediasis.businesses b
left join auth.users u on u.id = b.uid
left join mediasis.app_users au
  on lower(au.primary_email) = lower(pg_catalog.btrim(u.email))
 and au.status = 'active' and au.deleted_at is null
left join mediasis.business_memberships bm
  on bm.business_id = b.uid
 and bm.app_user_id = au.app_user_id
where coalesce(b.active, false)
on conflict (business_id) do update
set legacy_email = excluded.legacy_email,
    updated_at = now();

create or replace function mediasis.get_legacy_business_clerk_migration_preflight(
  p_business_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'success', true,
    'rows', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'business_id', b.uid,
      'business_name', b.full_name,
      'email', lower(pg_catalog.btrim(u.email)),
      'status', m.status,
      'organization_mapped', b.clerk_organization_id is not null,
      'clerk_organization_id', b.clerk_organization_id,
      'ready',
        coalesce(b.active, false)
        and u.id is not null
        and nullif(pg_catalog.btrim(u.email), '') is not null
        and coalesce(u.encrypted_password, '') ~ '^\$2[aby]\$[0-9]{2}\$'
        and exists (
          select 1 from mediasis.business_roles br
          where br.business_id = b.uid and br.role_key = 'business_full_access'
            and br.active and br.archived_at is null
        ),
      'failure_code', case
        when not coalesce(b.active, false) then 'business_inactive'
        when u.id is null then 'legacy_auth_user_missing'
        when nullif(pg_catalog.btrim(u.email), '') is null then 'legacy_email_missing'
        when coalesce(u.encrypted_password, '') !~ '^\$2[aby]\$[0-9]{2}\$' then 'unsupported_password_digest'
        when not exists (
          select 1 from mediasis.business_roles br
          where br.business_id = b.uid and br.role_key = 'business_full_access'
            and br.active and br.archived_at is null
        ) then 'full_access_role_missing'
        else null
      end
    ) order by b.full_name, b.uid), '[]'::jsonb)
  )
  from mediasis.businesses b
  left join auth.users u on u.id = b.uid
  left join mediasis.legacy_business_clerk_migrations m on m.business_id = b.uid
  where coalesce(b.active, false)
    and (p_business_id is null or b.uid = p_business_id);
$$;

create or replace function mediasis.prepare_legacy_business_clerk_migration(
  p_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business mediasis.businesses%rowtype;
  v_auth_user auth.users%rowtype;
  v_migration mediasis.legacy_business_clerk_migrations%rowtype;
begin
  select * into v_business from mediasis.businesses b
  where b.uid = p_business_id and coalesce(b.active, false)
  for update;
  if not found then raise exception 'Active legacy business not found'; end if;

  select * into v_auth_user from auth.users u where u.id = p_business_id;
  if not found then raise exception 'Matching legacy Auth user not found'; end if;
  if nullif(pg_catalog.btrim(v_auth_user.email), '') is null then
    raise exception 'Legacy email is missing';
  end if;
  if coalesce(v_auth_user.encrypted_password, '') !~ '^\$2[aby]\$[0-9]{2}\$' then
    raise exception 'Legacy password is not a supported bcrypt digest';
  end if;
  if exists (
    select 1 from auth.users other
    where other.id <> p_business_id
      and lower(pg_catalog.btrim(other.email)) = lower(pg_catalog.btrim(v_auth_user.email))
  ) then raise exception 'Legacy email is duplicated'; end if;
  if not exists (
    select 1 from mediasis.business_roles br
    where br.business_id = p_business_id and br.role_key = 'business_full_access'
      and br.active and br.archived_at is null
  ) then raise exception 'Full access role is unavailable'; end if;

  insert into mediasis.legacy_business_clerk_migrations (
    business_id, legacy_email, clerk_organization_id, status, attempts, started_at
  ) values (
    p_business_id, lower(pg_catalog.btrim(v_auth_user.email)),
    v_business.clerk_organization_id, 'prepared', 1, now()
  )
  on conflict (business_id) do update
  set legacy_email = excluded.legacy_email,
      clerk_organization_id = coalesce(
        mediasis.legacy_business_clerk_migrations.clerk_organization_id,
        excluded.clerk_organization_id
      ),
      status = case
        when mediasis.legacy_business_clerk_migrations.status = 'completed' then 'completed'
        else 'prepared'
      end,
      attempts = mediasis.legacy_business_clerk_migrations.attempts + 1,
      started_at = coalesce(mediasis.legacy_business_clerk_migrations.started_at, now()),
      last_error_code = null,
      last_error = null,
      updated_at = now()
  returning * into v_migration;

  -- This digest is intentionally exposed only through this temporary,
  -- service-role-only function and is never stored in the migration table.
  return pg_catalog.jsonb_build_object(
    'success', true,
    'business_id', v_business.uid,
    'business_name', v_business.full_name,
    'email', lower(pg_catalog.btrim(v_auth_user.email)),
    'password_digest', v_auth_user.encrypted_password,
    'status', v_migration.status,
    'clerk_user_id', v_migration.clerk_user_id,
    'clerk_organization_id', coalesce(v_migration.clerk_organization_id, v_business.clerk_organization_id),
    'clerk_membership_id', v_migration.clerk_membership_id
  );
end;
$$;

create or replace function mediasis.checkpoint_legacy_business_clerk_migration(
  p_business_id uuid,
  p_status text,
  p_clerk_user_id text default null,
  p_clerk_organization_id text default null,
  p_clerk_membership_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row mediasis.legacy_business_clerk_migrations%rowtype;
begin
  if p_status not in ('user_created', 'organization_created', 'membership_created') then
    raise exception 'Invalid migration checkpoint';
  end if;
  select * into v_row from mediasis.legacy_business_clerk_migrations
  where business_id = p_business_id for update;
  if not found then raise exception 'Migration record not found'; end if;
  if v_row.status = 'completed' then
    return pg_catalog.jsonb_build_object('success', true, 'duplicate', true);
  end if;
  if v_row.clerk_user_id is not null and p_clerk_user_id is not null
    and v_row.clerk_user_id <> pg_catalog.btrim(p_clerk_user_id) then
    raise exception 'A different Clerk user is already recorded';
  end if;
  if v_row.clerk_organization_id is not null and p_clerk_organization_id is not null
    and v_row.clerk_organization_id <> pg_catalog.btrim(p_clerk_organization_id) then
    raise exception 'A different Clerk Organization is already recorded';
  end if;
  if v_row.clerk_membership_id is not null and p_clerk_membership_id is not null
    and v_row.clerk_membership_id <> pg_catalog.btrim(p_clerk_membership_id) then
    raise exception 'A different Clerk membership is already recorded';
  end if;

  update mediasis.legacy_business_clerk_migrations
  set clerk_user_id = coalesce(clerk_user_id, nullif(pg_catalog.btrim(p_clerk_user_id), '')),
      clerk_organization_id = coalesce(clerk_organization_id, nullif(pg_catalog.btrim(p_clerk_organization_id), '')),
      clerk_membership_id = coalesce(clerk_membership_id, nullif(pg_catalog.btrim(p_clerk_membership_id), '')),
      status = p_status, last_error_code = null, last_error = null, updated_at = now()
  where business_id = p_business_id;
  return pg_catalog.jsonb_build_object('success', true, 'business_id', p_business_id, 'status', p_status);
end;
$$;

create or replace function mediasis.fail_legacy_business_clerk_migration(
  p_business_id uuid,
  p_error_code text,
  p_error text,
  p_conflict boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update mediasis.legacy_business_clerk_migrations
  set status = case when p_conflict then 'conflict' else 'failed' end,
      last_error_code = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_error_code), ''), 'unknown'), 100),
      last_error = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_error), ''), 'Migration failed'), 500),
      updated_at = now()
  where business_id = p_business_id and status <> 'completed';
  return pg_catalog.jsonb_build_object('success', true, 'business_id', p_business_id);
end;
$$;

create or replace function mediasis.complete_legacy_business_clerk_migration(
  p_business_id uuid,
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
  v_migration mediasis.legacy_business_clerk_migrations%rowtype;
  v_app_user_id uuid;
  v_email_app_user_id uuid;
  v_role_id uuid;
  v_membership_id uuid;
begin
  if nullif(pg_catalog.btrim(p_clerk_user_id), '') is null
    or nullif(pg_catalog.btrim(p_clerk_organization_id), '') is null
    or nullif(pg_catalog.btrim(p_clerk_membership_id), '') is null then
    raise exception 'Complete Clerk identifiers are required';
  end if;

  select * into v_migration from mediasis.legacy_business_clerk_migrations
  where business_id = p_business_id for update;
  if not found then raise exception 'Migration record not found'; end if;
  if v_migration.status = 'completed' then
    return pg_catalog.jsonb_build_object('success', true, 'duplicate', true, 'business_id', p_business_id);
  end if;
  if v_migration.clerk_user_id is distinct from pg_catalog.btrim(p_clerk_user_id)
    or v_migration.clerk_organization_id is distinct from pg_catalog.btrim(p_clerk_organization_id)
    or v_migration.clerk_membership_id is distinct from pg_catalog.btrim(p_clerk_membership_id) then
    raise exception 'Clerk identifiers do not match the migration checkpoints';
  end if;
  if exists (
    select 1 from mediasis.businesses b
    where b.clerk_organization_id = p_clerk_organization_id and b.uid <> p_business_id
  ) then raise exception 'Clerk Organization belongs to another business'; end if;

  select au.app_user_id into v_app_user_id from mediasis.app_users au
  where au.clerk_user_id = p_clerk_user_id for update;
  select au.app_user_id into v_email_app_user_id from mediasis.app_users au
  where lower(au.primary_email) = lower(v_migration.legacy_email)
    and au.status <> 'deleted' for update;
  if v_app_user_id is not null and v_email_app_user_id is not null
    and v_app_user_id <> v_email_app_user_id then
    raise exception 'Clerk user and legacy email resolve to different Mediasis identities';
  end if;
  if v_app_user_id is null and v_email_app_user_id is not null then
    if exists (
      select 1 from mediasis.app_users au where au.app_user_id = v_email_app_user_id
        and au.clerk_user_id <> p_clerk_user_id
    ) then raise exception 'Legacy email belongs to another Clerk identity'; end if;
    v_app_user_id := v_email_app_user_id;
  end if;
  if v_app_user_id is null then
    insert into mediasis.app_users (clerk_user_id, primary_email, display_name, status, deleted_at)
    select p_clerk_user_id, v_migration.legacy_email, b.full_name, 'active', null
    from mediasis.businesses b where b.uid = p_business_id
    returning app_user_id into v_app_user_id;
  else
    update mediasis.app_users
    set primary_email = coalesce(primary_email, v_migration.legacy_email),
        status = 'active', deleted_at = null, updated_at = now()
    where app_user_id = v_app_user_id;
  end if;

  update mediasis.businesses set clerk_organization_id = p_clerk_organization_id
  where uid = p_business_id
    and (clerk_organization_id is null or clerk_organization_id = p_clerk_organization_id);
  if not found then raise exception 'Business is mapped to another Clerk Organization'; end if;

  select br.business_role_id into v_role_id from mediasis.business_roles br
  where br.business_id = p_business_id and br.role_key = 'business_full_access'
    and br.active and br.archived_at is null for update;
  if v_role_id is null then raise exception 'Full access role is unavailable'; end if;

  update mediasis.business_membership_locations
  set revoked_at = coalesce(revoked_at, now()), updated_at = now()
  where business_membership_id in (
    select bm.business_membership_id from mediasis.business_memberships bm
    where bm.business_id = p_business_id and bm.app_user_id = v_app_user_id
  ) and revoked_at is null;

  insert into mediasis.business_memberships (
    business_id, app_user_id, clerk_membership_id, status, revoked_at, all_locations
  ) values (
    p_business_id, v_app_user_id, p_clerk_membership_id, 'active', null, true
  )
  on conflict (business_id, app_user_id) do update
  set clerk_membership_id = excluded.clerk_membership_id,
      status = 'active', revoked_at = null, all_locations = true, updated_at = now()
  returning business_membership_id into v_membership_id;

  update mediasis.business_membership_roles
  set revoked_at = coalesce(revoked_at, now())
  where business_membership_id = v_membership_id
    and business_role_id <> v_role_id and revoked_at is null;
  insert into mediasis.business_membership_roles (
    business_membership_id, business_role_id, business_id, revoked_at
  ) values (v_membership_id, v_role_id, p_business_id, null)
  on conflict (business_membership_id, business_role_id) do update set revoked_at = null;

  update mediasis.legacy_business_clerk_migrations
  set status = 'completed', completed_at = coalesce(completed_at, now()),
      last_error_code = null, last_error = null, updated_at = now()
  where business_id = p_business_id;

  insert into mediasis.authorization_audit_log (
    subject_app_user_id, business_id, action, target_type, target_id,
    after_value, request_id, source
  ) values (
    v_app_user_id, p_business_id, 'legacy_business.clerk_migrated',
    'business_membership', v_membership_id::text,
    pg_catalog.jsonb_build_object(
      'clerk_user_id', p_clerk_user_id,
      'clerk_organization_id', p_clerk_organization_id,
      'role_key', 'business_full_access', 'all_locations', true
    ),
    'legacy-clerk-migration:' || p_business_id::text, 'migration'
  );

  return pg_catalog.jsonb_build_object(
    'success', true, 'business_id', p_business_id,
    'app_user_id', v_app_user_id, 'business_membership_id', v_membership_id
  );
end;
$$;

create or replace function mediasis.verify_legacy_business_clerk_migration()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'success', true,
    'active_businesses', count(*),
    'completed', count(*) filter (where m.status = 'completed'),
    'incomplete', count(*) filter (where m.status is distinct from 'completed'),
    'organization_mapped', count(*) filter (where b.clerk_organization_id is not null),
    'active_full_access_memberships', count(*) filter (where exists (
      select 1
      from mediasis.business_memberships bm
      join mediasis.business_membership_roles bmr
        on bmr.business_membership_id = bm.business_membership_id
       and bmr.business_id = bm.business_id and bmr.revoked_at is null
      join mediasis.business_roles br
        on br.business_role_id = bmr.business_role_id and br.business_id = bm.business_id
       and br.role_key = 'business_full_access' and br.active and br.archived_at is null
      where bm.business_id = b.uid and bm.status = 'active' and bm.revoked_at is null
        and bm.all_locations and bm.clerk_membership_id is not null
    )),
    'ready_for_cleanup', bool_and(
      m.status = 'completed'
      and b.clerk_organization_id is not null
      and exists (
        select 1
        from mediasis.business_memberships bm
        join mediasis.business_membership_roles bmr
          on bmr.business_membership_id = bm.business_membership_id
         and bmr.business_id = bm.business_id and bmr.revoked_at is null
        join mediasis.business_roles br
          on br.business_role_id = bmr.business_role_id and br.business_id = bm.business_id
         and br.role_key = 'business_full_access' and br.active and br.archived_at is null
        where bm.business_id = b.uid and bm.status = 'active' and bm.revoked_at is null
          and bm.all_locations and bm.clerk_membership_id is not null
      )
    )
  )
  from mediasis.businesses b
  left join mediasis.legacy_business_clerk_migrations m on m.business_id = b.uid
  where coalesce(b.active, false);
$$;

revoke all on function mediasis.get_legacy_business_clerk_migration_preflight(uuid)
  from public, anon, authenticated;
revoke all on function mediasis.prepare_legacy_business_clerk_migration(uuid)
  from public, anon, authenticated;
revoke all on function mediasis.checkpoint_legacy_business_clerk_migration(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke all on function mediasis.fail_legacy_business_clerk_migration(uuid,text,text,boolean)
  from public, anon, authenticated;
revoke all on function mediasis.complete_legacy_business_clerk_migration(uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function mediasis.verify_legacy_business_clerk_migration()
  from public, anon, authenticated;

grant execute on function mediasis.get_legacy_business_clerk_migration_preflight(uuid) to service_role;
grant execute on function mediasis.prepare_legacy_business_clerk_migration(uuid) to service_role;
grant execute on function mediasis.checkpoint_legacy_business_clerk_migration(uuid,text,text,text,text) to service_role;
grant execute on function mediasis.fail_legacy_business_clerk_migration(uuid,text,text,boolean) to service_role;
grant execute on function mediasis.complete_legacy_business_clerk_migration(uuid,text,text,text) to service_role;
grant execute on function mediasis.verify_legacy_business_clerk_migration() to service_role;

commit;
