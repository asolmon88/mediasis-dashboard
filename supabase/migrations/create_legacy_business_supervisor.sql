-- Migration: 067
-- Purpose: Allow authorized full-access administrators to create the single
-- temporary Supabase Supervisor login required by the legacy native app.

begin;

create or replace function mediasis.prepare_legacy_business_supervisor(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_authorized boolean := false;
begin
  if p_business_id is null or p_actor_app_user_id is null then
    raise exception 'Negocio o administrador inválido';
  end if;
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Correo inválido';
  end if;
  if not exists (
    select 1 from mediasis.businesses b
    where b.uid = p_business_id and coalesce(b.active, false)
  ) then
    raise exception 'Negocio no disponible';
  end if;

  v_authorized := mediasis.is_mediasis_staff_actor(p_actor_app_user_id) or exists (
    select 1
    from mediasis.business_memberships bm
    join mediasis.business_membership_roles bmr
      on bmr.business_membership_id = bm.business_membership_id
     and bmr.business_id = bm.business_id
     and bmr.revoked_at is null
    join mediasis.business_roles br
      on br.business_role_id = bmr.business_role_id
     and br.business_id = bm.business_id
     and br.role_key = 'business_full_access'
     and br.active
     and br.archived_at is null
    where bm.business_id = p_business_id
      and bm.app_user_id = p_actor_app_user_id
      and bm.status = 'active'
      and bm.revoked_at is null
  );
  if not v_authorized then
    raise exception 'No tenés permiso para crear el Supervisor legacy';
  end if;

  if exists (select 1 from auth.users u where u.id = p_business_id) then
    return jsonb_build_object(
      'success', false,
      'already_exists', true,
      'message', 'Este negocio ya tiene un Supervisor legacy'
    );
  end if;
  if exists (select 1 from auth.users u where pg_catalog.lower(u.email) = v_email) then
    raise exception 'Este correo ya pertenece a otra cuenta de Supabase';
  end if;

  return jsonb_build_object('success', true, 'email', v_email);
end;
$$;

create or replace function mediasis.complete_legacy_business_supervisor(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  -- Re-run the full-access check. An already-created auth row is expected at
  -- this stage, so only the authorization result from preparation is needed.
  if not (
    mediasis.is_mediasis_staff_actor(p_actor_app_user_id) or exists (
      select 1
      from mediasis.business_memberships bm
      join mediasis.business_membership_roles bmr
        on bmr.business_membership_id = bm.business_membership_id
       and bmr.business_id = bm.business_id
       and bmr.revoked_at is null
      join mediasis.business_roles br
        on br.business_role_id = bmr.business_role_id
       and br.business_id = bm.business_id
       and br.role_key = 'business_full_access'
       and br.active
       and br.archived_at is null
      where bm.business_id = p_business_id
        and bm.app_user_id = p_actor_app_user_id
        and bm.status = 'active'
        and bm.revoked_at is null
    )
  ) then
    raise exception 'No tenés permiso para crear el Supervisor legacy';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = p_business_id and pg_catalog.lower(u.email) = v_email
  ) then
    raise exception 'La identidad de Supervisor legacy no coincide con el negocio';
  end if;

  insert into mediasis.authorization_audit_log (
    actor_app_user_id, business_id, action, target_type, target_id, after_value
  ) values (
    p_actor_app_user_id,
    p_business_id,
    'business.legacy_supervisor.created',
    'supabase_auth_user',
    p_business_id::text,
    jsonb_build_object('email', v_email, 'scope', 'business_full_access')
  );

  return jsonb_build_object('success', true, 'business_id', p_business_id);
end;
$$;

revoke all on function mediasis.prepare_legacy_business_supervisor(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function mediasis.complete_legacy_business_supervisor(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function mediasis.prepare_legacy_business_supervisor(uuid, uuid, text)
  to service_role;
grant execute on function mediasis.complete_legacy_business_supervisor(uuid, uuid, text)
  to service_role;

comment on function mediasis.prepare_legacy_business_supervisor(uuid, uuid, text) is
  'Validates creation of the single business-wide Supabase login used only by the legacy native app.';

commit;
