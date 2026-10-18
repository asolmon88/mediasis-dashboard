-- Migration: 053
-- Purpose: Authorize payment-method and cashback configuration.
-- Apply after migration 052. This file is not applied automatically.

begin;

insert into mediasis.business_permissions (permission_key, name, description, active, archived_at)
values
  ('ordering_app.payment_methods.manage.full', 'Administrar métodos de pago',
   'Administrar visibilidad y disponibilidad de métodos de pago en las ubicaciones permitidas.', true, null),
  ('ordering_app.cashback.manage.full', 'Administrar cashback',
   'Activar, desactivar y cambiar el porcentaje de cashback del negocio.', true, null)
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key, revoked_at)
select br.business_role_id, permission.permission_key, null
from mediasis.business_roles br
cross join (values
  ('ordering_app.payment_methods.manage.full'::text),
  ('ordering_app.cashback.manage.full'::text)
) permission(permission_key)
where br.business_id is not null
  and br.role_key = 'business_full_access'
  and br.active
  and br.archived_at is null
on conflict (business_role_id, permission_key) do update set revoked_at = null;

create or replace function mediasis.require_ordering_app_payment_methods_access(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_app_user_id is null then return true; end if;
  if not mediasis.team_actor_has_permission(
    p_business_id, p_actor_app_user_id, 'ordering_app.payment_methods.manage.full'
  ) then
    raise exception 'Not authorized';
  end if;
  return true;
end;
$$;

create or replace function mediasis.require_ordering_app_cashback_access(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_app_user_id is null then return true; end if;
  if not mediasis.team_actor_has_permission(
    p_business_id, p_actor_app_user_id, 'ordering_app.cashback.manage.full'
  ) then
    raise exception 'Not authorized';
  end if;
  return true;
end;
$$;

create or replace function mediasis.get_business_ordering_app_payments_cashback_permission_catalog(
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
  v_roles jsonb;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.read');

  select coalesce(
    jsonb_object_agg(br.business_role_id::text, coalesce(keys.permission_keys, '[]'::jsonb)),
    '{}'::jsonb
  )
  into v_roles
  from mediasis.business_roles br
  left join lateral (
    select jsonb_agg(brp.permission_key order by brp.permission_key) as permission_keys
    from mediasis.business_role_permissions brp
    where brp.business_role_id = br.business_role_id
      and brp.permission_key in (
        'ordering_app.payment_methods.manage.full',
        'ordering_app.cashback.manage.full'
      )
      and brp.revoked_at is null
  ) keys on true
  where br.business_id = p_business_id
    and br.active
    and br.archived_at is null;

  return jsonb_build_object(
    'success', true,
    'permissions', jsonb_build_array(
      jsonb_build_object(
        'key', 'ordering_app.payment_methods.manage.full',
        'name', 'Administrar métodos de pago',
        'description', 'Administrar visibilidad y disponibilidad de métodos de pago.'
      ),
      jsonb_build_object(
        'key', 'ordering_app.cashback.manage.full',
        'name', 'Administrar cashback',
        'description', 'Activar, desactivar y cambiar el porcentaje de cashback.'
      )
    ),
    'role_permissions', v_roles
  );
end;
$$;

create or replace function mediasis.ordering_app_payment_actor_all_locations(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all_locations boolean;
begin
  perform mediasis.require_ordering_app_payment_methods_access(p_business_id, p_actor_app_user_id);
  if p_actor_app_user_id is null then return true; end if;

  select bm.all_locations
  into v_all_locations
  from mediasis.business_memberships bm
  where bm.business_id = p_business_id
    and bm.app_user_id = p_actor_app_user_id
    and bm.status = 'active'
    and bm.revoked_at is null;

  return coalesce(v_all_locations, false);
end;
$$;

create or replace function mediasis.ordering_app_payment_location_allowed(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_location_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from mediasis.business_location bl
    where bl.business_uid = p_business_id
      and bl.business_location_id = p_location_id
  ) then return false; end if;

  if mediasis.ordering_app_payment_actor_all_locations(p_business_id, p_actor_app_user_id) then
    return true;
  end if;

  return exists (
    select 1
    from mediasis.business_memberships bm
    join mediasis.business_membership_locations bml
      on bml.business_membership_id = bm.business_membership_id
     and bml.revoked_at is null
    where bm.business_id = p_business_id
      and bm.app_user_id = p_actor_app_user_id
      and bm.status = 'active'
      and bm.revoked_at is null
      and bml.business_location_id = p_location_id
  );
end;
$$;

create or replace function mediasis.get_ordering_app_payment_methods(
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
  v_all_locations boolean;
begin
  perform mediasis.require_ordering_app_payment_methods_access(p_business_id, p_actor_app_user_id);
  v_all_locations := mediasis.ordering_app_payment_actor_all_locations(p_business_id, p_actor_app_user_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'business_payment_method_id', bpm.business_payment_method_id,
      'payment_method_id', bpm.payment_method_id,
      'name', pm.name,
      'visible', coalesce(bpm.visible, true),
      'scope', bpm.scope::text,
      'business_location_ids', coalesce((
        select jsonb_agg(bpml.business_location_id order by bpml.business_location_id)
        from mediasis.business_payment_method_location bpml
        where bpml.business_payment_method_id = bpm.business_payment_method_id
          and (
            v_all_locations
            or mediasis.ordering_app_payment_location_allowed(
              p_business_id, p_actor_app_user_id, bpml.business_location_id
            )
          )
      ), '[]'::jsonb)
    ) order by pm.name)
    from mediasis.business_payment_method bpm
    join mediasis.payment_method pm on pm.uid = bpm.payment_method_id
    where bpm.business_id = p_business_id
  ), '[]'::jsonb);
end;
$$;

create or replace function mediasis.update_ordering_app_payment_method(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_payment_method_id uuid,
  p_visible boolean,
  p_scope text,
  p_location_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method mediasis.business_payment_method%rowtype;
  v_all_locations boolean;
  v_location_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  perform mediasis.require_ordering_app_payment_methods_access(p_business_id, p_actor_app_user_id);
  if p_scope not in ('all', 'specific') then raise exception 'Invalid payment method scope'; end if;

  select bpm.* into v_method
  from mediasis.business_payment_method bpm
  where bpm.business_payment_method_id = p_business_payment_method_id
    and bpm.business_id = p_business_id
  for update;
  if not found then raise exception 'Payment method not found'; end if;

  v_all_locations := mediasis.ordering_app_payment_actor_all_locations(p_business_id, p_actor_app_user_id);
  v_before := jsonb_build_object(
    'visible', v_method.visible,
    'scope', v_method.scope::text,
    'location_ids', coalesce((select jsonb_agg(bpml.business_location_id)
      from mediasis.business_payment_method_location bpml
      where bpml.business_payment_method_id = p_business_payment_method_id), '[]'::jsonb)
  );

  if not v_all_locations and p_scope = 'all' then
    if v_method.scope::text <> 'all' then raise exception 'Not authorized'; end if;
    update mediasis.business_payment_method
    set visible = p_visible
    where business_payment_method_id = p_business_payment_method_id;
  elsif v_all_locations and p_scope = 'all' then
    delete from mediasis.business_payment_method_location
    where business_payment_method_id = p_business_payment_method_id;
    update mediasis.business_payment_method
    set visible = p_visible, scope = 'all'
    where business_payment_method_id = p_business_payment_method_id;
  else
    if not v_all_locations and v_method.scope::text = 'all' then
      raise exception 'Not authorized';
    end if;
    if v_all_locations and cardinality(coalesce(p_location_ids, '{}'::uuid[])) = 0 then
      raise exception 'Select at least one business location';
    end if;

    foreach v_location_id in array p_location_ids loop
      if not mediasis.ordering_app_payment_location_allowed(
        p_business_id, p_actor_app_user_id, v_location_id
      ) then raise exception 'Not authorized'; end if;
    end loop;

    if v_all_locations then
      delete from mediasis.business_payment_method_location
      where business_payment_method_id = p_business_payment_method_id;
    else
      delete from mediasis.business_payment_method_location bpml
      where bpml.business_payment_method_id = p_business_payment_method_id
        and mediasis.ordering_app_payment_location_allowed(
          p_business_id, p_actor_app_user_id, bpml.business_location_id
        );
    end if;

    insert into mediasis.business_payment_method_location (
      business_payment_method_id, business_location_id
    )
    select p_business_payment_method_id, requested.location_id
    from unnest(p_location_ids) requested(location_id)
    on conflict do nothing;

    if not exists (
      select 1 from mediasis.business_payment_method_location bpml
      where bpml.business_payment_method_id = p_business_payment_method_id
    ) then raise exception 'Select at least one business location'; end if;

    update mediasis.business_payment_method
    set visible = p_visible, scope = 'specific'
    where business_payment_method_id = p_business_payment_method_id;
  end if;

  select jsonb_build_object(
    'visible', bpm.visible,
    'scope', bpm.scope::text,
    'location_ids', coalesce((select jsonb_agg(bpml.business_location_id)
      from mediasis.business_payment_method_location bpml
      where bpml.business_payment_method_id = bpm.business_payment_method_id), '[]'::jsonb)
  ) into v_after
  from mediasis.business_payment_method bpm
  where bpm.business_payment_method_id = p_business_payment_method_id;

  insert into mediasis.authorization_audit_log (
    actor_app_user_id, business_id, action, target_type, target_id,
    before_value, after_value
  ) values (
    p_actor_app_user_id, p_business_id, 'ordering_app.payment_method.updated',
    'business_payment_method', p_business_payment_method_id::text, v_before, v_after
  );

  return jsonb_build_object('success', true);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

create or replace function mediasis.get_ordering_app_cashback_settings(
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
  v_row mediasis.business_cashback_settings%rowtype;
begin
  perform mediasis.require_ordering_app_cashback_access(p_business_id, p_actor_app_user_id);
  select * into v_row from mediasis.business_cashback_settings s
  where s.business_uid = p_business_id;
  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'enabled', coalesce(v_row.enabled, false),
      'percentage', coalesce(v_row.percentage, 0),
      'updated_at', v_row.updated_at
    )
  );
end;
$$;

create or replace function mediasis.update_ordering_app_cashback_settings(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_enabled boolean,
  p_percentage numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform mediasis.require_ordering_app_cashback_access(p_business_id, p_actor_app_user_id);
  if p_percentage is null or p_percentage < 0 or p_percentage > 100
     or p_percentage <> round(p_percentage, 2) then
    raise exception 'Percentage must have at most two decimals and be between 0 and 100';
  end if;

  select to_jsonb(s) into v_before
  from mediasis.business_cashback_settings s
  where s.business_uid = p_business_id
  for update;

  insert into mediasis.business_cashback_settings (
    business_uid, enabled, percentage, updated_by_business_uid
  ) values (p_business_id, p_enabled, p_percentage, p_business_id)
  on conflict (business_uid) do update
  set enabled = excluded.enabled,
      percentage = excluded.percentage,
      updated_by_business_uid = excluded.updated_by_business_uid,
      updated_at = now();

  insert into mediasis.authorization_audit_log (
    actor_app_user_id, business_id, action, target_type, target_id,
    before_value, after_value
  ) values (
    p_actor_app_user_id, p_business_id, 'ordering_app.cashback.updated',
    'business_cashback_settings', p_business_id::text, v_before,
    jsonb_build_object('enabled', p_enabled, 'percentage', p_percentage)
  );

  return jsonb_build_object('success', true);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

do $$
declare
  c record;
  definition text;
begin
  for c in
    select constraint_name
    from information_schema.referential_constraints
    where constraint_schema = 'mediasis'
      and constraint_name in (
        select tc.constraint_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_schema = tc.constraint_schema
         and kcu.constraint_name = tc.constraint_name
        where tc.table_schema = 'mediasis'
          and tc.table_name = 'business_payment_method_location'
          and kcu.column_name = 'business_location_id'
      )
      and update_rule <> 'CASCADE'
  loop
    select pg_catalog.pg_get_constraintdef(pc.oid) into definition
    from pg_catalog.pg_constraint pc
    where pc.connamespace = 'mediasis'::regnamespace
      and pc.conname = c.constraint_name;
    definition := pg_catalog.regexp_replace(
      definition, ' ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)', '', 'i'
    );
    if definition ~* ' ON DELETE ' then
      definition := pg_catalog.regexp_replace(definition, ' ON DELETE ', ' ON UPDATE CASCADE ON DELETE ', 'i');
    else
      definition := definition || ' ON UPDATE CASCADE';
    end if;
    execute pg_catalog.format(
      'alter table mediasis.business_payment_method_location drop constraint %I', c.constraint_name
    );
    execute pg_catalog.format(
      'alter table mediasis.business_payment_method_location add constraint %I %s',
      c.constraint_name, definition
    );
  end loop;
end;
$$;

revoke all on function mediasis.require_ordering_app_payment_methods_access(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.require_ordering_app_cashback_access(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.get_business_ordering_app_payments_cashback_permission_catalog(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.ordering_app_payment_actor_all_locations(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.ordering_app_payment_location_allowed(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.get_ordering_app_payment_methods(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.update_ordering_app_payment_method(uuid,uuid,uuid,boolean,text,uuid[]) from public, anon, authenticated;
revoke all on function mediasis.get_ordering_app_cashback_settings(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.update_ordering_app_cashback_settings(uuid,uuid,boolean,numeric) from public, anon, authenticated;

grant execute on function mediasis.require_ordering_app_payment_methods_access(uuid,uuid) to service_role;
grant execute on function mediasis.require_ordering_app_cashback_access(uuid,uuid) to service_role;
grant execute on function mediasis.get_business_ordering_app_payments_cashback_permission_catalog(uuid,uuid) to service_role;
grant execute on function mediasis.ordering_app_payment_actor_all_locations(uuid,uuid) to service_role;
grant execute on function mediasis.ordering_app_payment_location_allowed(uuid,uuid,uuid) to service_role;
grant execute on function mediasis.get_ordering_app_payment_methods(uuid,uuid) to service_role;
grant execute on function mediasis.update_ordering_app_payment_method(uuid,uuid,uuid,boolean,text,uuid[]) to service_role;
grant execute on function mediasis.get_ordering_app_cashback_settings(uuid,uuid) to service_role;
grant execute on function mediasis.update_ordering_app_cashback_settings(uuid,uuid,boolean,numeric) to service_role;

commit;
