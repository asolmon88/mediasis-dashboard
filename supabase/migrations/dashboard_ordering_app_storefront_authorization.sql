-- Migration: 048
-- Purpose: Authorize Inicio, Checkout and Apariencia with location-scoped configuration.
-- Apply after migration 047. This file is not applied automatically.

begin;

insert into mediasis.business_permissions (permission_key, name, description, active, archived_at)
values (
  'ordering_app.storefront.manage.full',
  'Administrar inicio, checkout y apariencia',
  'Administrar la configuración general de la app de pedidos y sus ajustes permitidos por ubicación.',
  true,
  null
)
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key)
select br.business_role_id, 'ordering_app.storefront.manage.full'
from mediasis.business_roles br
where br.business_id is not null
  and br.role_key = 'business_full_access'
  and br.active
  and br.archived_at is null
on conflict (business_role_id, permission_key) do update set revoked_at = null;

create or replace function mediasis.require_ordering_app_storefront_access(
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
  if not mediasis.team_actor_has_permission(
    p_business_id,
    p_actor_app_user_id,
    'ordering_app.storefront.manage.full'
  ) then
    raise exception 'Not authorized';
  end if;
  return true;
end;
$$;

create or replace function mediasis.get_business_ordering_app_storefront_permission_catalog(
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
  v_role_permissions jsonb;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.read');

  select coalesce(
    jsonb_object_agg(br.business_role_id::text, coalesce(keys.permission_keys, '[]'::jsonb)),
    '{}'::jsonb
  )
  into v_role_permissions
  from mediasis.business_roles br
  left join lateral (
    select jsonb_agg(brp.permission_key order by brp.permission_key) permission_keys
    from mediasis.business_role_permissions brp
    where brp.business_role_id = br.business_role_id
      and brp.permission_key = 'ordering_app.storefront.manage.full'
      and brp.revoked_at is null
  ) keys on true
  where br.business_id = p_business_id
    and br.active
    and br.archived_at is null;

  return jsonb_build_object(
    'success', true,
    'permissions', jsonb_build_array(jsonb_build_object(
      'key', 'ordering_app.storefront.manage.full',
      'name', 'Administrar inicio, checkout y apariencia',
      'description', 'Administrar la configuración inicial, checkout y apariencia de la app de pedidos.'
    )),
    'role_permissions', v_role_permissions
  );
end;
$$;

create or replace function mediasis.save_ordering_app_loyalty_programs(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_configs jsonb,
  p_delete_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership mediasis.business_memberships%rowtype;
  v_config jsonb;
  v_program_id uuid;
  v_requested_ids uuid[];
  v_protected_ids uuid[];
  v_final_ids uuid[];
  v_existing_scope mediasis.scope;
  v_program_type text;
  v_card_url text;
  v_active boolean;
  v_delete_id uuid;
begin
  perform mediasis.require_ordering_app_storefront_access(p_business_id, p_actor_app_user_id);
  if jsonb_typeof(coalesce(p_configs, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid loyalty configuration payload';
  end if;

  select bm.* into v_membership
  from mediasis.business_memberships bm
  where bm.business_id = p_business_id
    and bm.app_user_id = p_actor_app_user_id
    and bm.status = 'active'
    and bm.revoked_at is null
  for update;
  if not found then raise exception 'Not authorized'; end if;

  perform 1 from mediasis.businesses b where b.uid = p_business_id for update;

  foreach v_delete_id in array coalesce(p_delete_ids, '{}'::uuid[]) loop
    select lp.scope into v_existing_scope
    from mediasis.loyalty_programs lp
    where lp.loyalty_program_id = v_delete_id and lp.business_id = p_business_id
    for update;
    if not found then raise exception 'Loyalty program not found'; end if;
    if not v_membership.all_locations and (
      v_existing_scope = 'all'::mediasis.scope or exists (
        select 1 from mediasis.loyalty_program_locations lpl
        where lpl.loyalty_program_id = v_delete_id
          and not exists (
            select 1 from mediasis.business_membership_locations bml
            where bml.business_membership_id = v_membership.business_membership_id
              and bml.business_location_id = lpl.business_location_id
              and bml.revoked_at is null
          )
      )
    ) then raise exception 'Cannot delete configuration assigned to protected locations'; end if;
    delete from mediasis.loyalty_programs where loyalty_program_id = v_delete_id;
  end loop;

  for v_config in select value from jsonb_array_elements(p_configs) loop
    v_program_id := nullif(v_config->>'loyalty_program_id', '')::uuid;
    v_program_type := lower(btrim(coalesce(v_config->>'program_type', '')));
    v_card_url := btrim(coalesce(v_config->>'card_url', ''));
    v_active := coalesce((v_config->>'active')::boolean, false);
    if v_program_type not in ('stamps', 'cashback', 'loyalty') or v_card_url = '' then
      raise exception 'Invalid loyalty program';
    end if;
    select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
    into v_requested_ids
    from jsonb_array_elements_text(coalesce(v_config->'location_ids', '[]'::jsonb));

    if exists (
      select 1 from unnest(v_requested_ids) requested(id)
      left join mediasis.business_location bl
        on bl.business_location_id = requested.id and bl.business_uid = p_business_id
      where bl.business_location_id is null
    ) then raise exception 'Invalid business location'; end if;

    if v_program_id is not null then
      select lp.scope into v_existing_scope
      from mediasis.loyalty_programs lp
      where lp.loyalty_program_id = v_program_id and lp.business_id = p_business_id
      for update;
      if not found then raise exception 'Loyalty program not found'; end if;
    else
      v_existing_scope := null;
    end if;

    if v_membership.all_locations then
      v_final_ids := v_requested_ids;
    elsif v_existing_scope = 'all'::mediasis.scope then
      v_final_ids := '{}'::uuid[];
    else
      if exists (
        select 1 from unnest(v_requested_ids) requested(id)
        where not exists (
          select 1 from mediasis.business_membership_locations bml
          where bml.business_membership_id = v_membership.business_membership_id
            and bml.business_location_id = requested.id and bml.revoked_at is null
        )
      ) then raise exception 'Not allowed for this business location'; end if;
      select coalesce(array_agg(lpl.business_location_id), '{}'::uuid[])
      into v_protected_ids
      from mediasis.loyalty_program_locations lpl
      where lpl.loyalty_program_id = v_program_id
        and not exists (
          select 1 from mediasis.business_membership_locations bml
          where bml.business_membership_id = v_membership.business_membership_id
            and bml.business_location_id = lpl.business_location_id and bml.revoked_at is null
        );
      select coalesce(array_agg(distinct id), '{}'::uuid[])
      into v_final_ids from unnest(v_requested_ids || v_protected_ids) requested(id);
      if v_program_id is null and cardinality(v_final_ids) = 0 then
        raise exception 'Select at least one permitted location';
      end if;
    end if;

    if v_program_id is null then
      insert into mediasis.loyalty_programs (business_id, scope, program_type, card_url, active)
      values (p_business_id, case when cardinality(v_final_ids)=0 then 'all'::mediasis.scope else 'specific'::mediasis.scope end,
        v_program_type, v_card_url, v_active)
      returning loyalty_program_id into v_program_id;
    else
      update mediasis.loyalty_programs
      set scope = case when cardinality(v_final_ids)=0 then 'all'::mediasis.scope else 'specific'::mediasis.scope end,
          program_type = v_program_type, card_url = v_card_url, active = v_active, updated_at = now()
      where loyalty_program_id = v_program_id;
      delete from mediasis.loyalty_program_locations where loyalty_program_id = v_program_id;
    end if;
    insert into mediasis.loyalty_program_locations (loyalty_program_id, business_location_id)
    select v_program_id, id from unnest(v_final_ids) requested(id) on conflict do nothing;
  end loop;

  if (select count(*) from mediasis.loyalty_programs where business_id=p_business_id and active and scope='all'::mediasis.scope) > 1
    or (exists(select 1 from mediasis.loyalty_programs where business_id=p_business_id and active and scope='all'::mediasis.scope)
        and (select count(*) from mediasis.loyalty_programs where business_id=p_business_id and active) > 1) then
    raise exception 'Invalid all-location loyalty configuration';
  end if;
  if exists (
    select lpl.business_location_id from mediasis.loyalty_program_locations lpl
    join mediasis.loyalty_programs lp on lp.loyalty_program_id=lpl.loyalty_program_id
    where lp.business_id=p_business_id and lp.active
    group by lpl.business_location_id having count(*) > 1
  ) then raise exception 'A location cannot have multiple active loyalty programs'; end if;

  perform mediasis.normalize_loyalty_programs_for_business(p_business_id);
  return jsonb_build_object('success', true);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

create or replace function mediasis.save_ordering_app_checkout_data(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_business_location_id uuid,
  p_checkout_data jsonb,
  p_manual_whatsapp boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership mediasis.business_memberships%rowtype;
  v_existing jsonb;
  v_location_ids jsonb;
begin
  perform mediasis.require_ordering_app_storefront_access(p_business_id, p_actor_app_user_id);
  select bm.* into v_membership
  from mediasis.business_memberships bm
  where bm.business_id=p_business_id and bm.app_user_id=p_actor_app_user_id
    and bm.status='active' and bm.revoked_at is null
  for update;
  if not found then raise exception 'Not authorized'; end if;
  if not exists (
    select 1 from mediasis.business_location bl
    where bl.business_location_id=p_business_location_id and bl.business_uid=p_business_id
      and (v_membership.all_locations or exists (
        select 1 from mediasis.business_membership_locations bml
        where bml.business_membership_id=v_membership.business_membership_id
          and bml.business_location_id=p_business_location_id and bml.revoked_at is null
      ))
  ) then raise exception 'Not allowed for this business location'; end if;

  insert into mediasis.business_app_metadata (business_id, checkout_data)
  values (p_business_id, '{}'::jsonb)
  on conflict (business_id) do nothing;
  select coalesce(bam.checkout_data, '{}'::jsonb) into v_existing
  from mediasis.business_app_metadata bam where bam.business_id=p_business_id for update;

  select coalesce(jsonb_agg(distinct value), '[]'::jsonb) into v_location_ids
  from (
    select value
    from jsonb_array_elements_text(coalesce(v_existing->'customer_sends_whatsapp_manually_location_ids','[]'::jsonb)) value
    where value <> p_business_location_id::text
    union all
    select p_business_location_id::text where coalesce(p_manual_whatsapp,false)
  ) ids;

  update mediasis.business_app_metadata
  set checkout_data = (coalesce(p_checkout_data,'{}'::jsonb)
      - 'customer_sends_whatsapp_manually'
      - 'customer_sends_whatsapp_manually_location_ids')
      || jsonb_build_object('customer_sends_whatsapp_manually_location_ids',v_location_ids)
  where business_id=p_business_id;
  return jsonb_build_object('success',true);
exception when others then
  return jsonb_build_object('success',false,'message',sqlerrm);
end;
$$;

revoke all on function mediasis.require_ordering_app_storefront_access(uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.get_business_ordering_app_storefront_permission_catalog(uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.save_ordering_app_loyalty_programs(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function mediasis.save_ordering_app_checkout_data(uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function mediasis.require_ordering_app_storefront_access(uuid, uuid) to service_role;
grant execute on function mediasis.get_business_ordering_app_storefront_permission_catalog(uuid, uuid) to service_role;
grant execute on function mediasis.save_ordering_app_loyalty_programs(uuid, uuid, jsonb, uuid[]) to service_role;
grant execute on function mediasis.save_ordering_app_checkout_data(uuid, uuid, uuid, jsonb, boolean) to service_role;

drop policy if exists "clerk storefront managers upload app metadata" on storage.objects;
create policy "clerk storefront managers upload app metadata"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'app_metadata'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and mediasis.has_business_permission(
    ((storage.foldername(name))[1])::uuid,
    'ordering_app.storefront.manage.full'
  )
);

commit;

-- Verification: every protected full-access role should have the permission.
select br.business_id
from mediasis.business_roles br
where br.role_key='business_full_access' and br.active and br.archived_at is null
  and not exists (
    select 1 from mediasis.business_role_permissions brp
    where brp.business_role_id=br.business_role_id
      and brp.permission_key='ordering_app.storefront.manage.full'
      and brp.revoked_at is null
  );
