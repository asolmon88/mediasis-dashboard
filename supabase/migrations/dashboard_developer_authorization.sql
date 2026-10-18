-- Migration: 057
-- Purpose: Authorize the complete developer section for legacy owners and Clerk business members.
-- Apply after migration 056. This file is not applied automatically.

begin;

insert into mediasis.business_permissions (permission_key, name, description, active, archived_at)
values (
  'developer.manage.full',
  'Administrar herramientas de desarrollador',
  'Administrar scripts personalizados y webhooks del negocio.',
  true,
  null
)
on conflict (permission_key) do update
set name = excluded.name,
    description = excluded.description,
    active = true,
    archived_at = null,
    updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key, revoked_at)
select br.business_role_id, 'developer.manage.full', null
from mediasis.business_roles br
where br.business_id is not null
  and br.role_key = 'business_full_access'
  and br.active
  and br.archived_at is null
on conflict (business_role_id, permission_key)
do update set revoked_at = null;

create or replace function mediasis.require_dashboard_developer_access(
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
    p_business_id,
    p_actor_app_user_id,
    'developer.manage.full'
  ) then
    raise exception 'Not authorized';
  end if;
  return true;
end;
$$;

create or replace function mediasis.developer_actor_can_use_location(
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
declare v_membership mediasis.business_memberships%rowtype;
begin
  perform mediasis.require_dashboard_developer_access(p_business_id, p_actor_app_user_id);
  if not exists (
    select 1 from mediasis.business_location bl
    where bl.business_uid = p_business_id
      and bl.business_location_id = p_location_id
  ) then return false; end if;
  if p_actor_app_user_id is null then return true; end if;
  select bm.* into v_membership
  from mediasis.business_memberships bm
  where bm.business_id = p_business_id
    and bm.app_user_id = p_actor_app_user_id
    and bm.status = 'active'
    and bm.revoked_at is null;
  if not found then return false; end if;
  return v_membership.all_locations or exists (
    select 1 from mediasis.business_membership_locations bml
    where bml.business_membership_id = v_membership.business_membership_id
      and bml.business_location_id = p_location_id
      and bml.revoked_at is null
  );
end;
$$;

create or replace function mediasis.get_dashboard_custom_tracking_code(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_code text;
begin
  perform mediasis.require_dashboard_developer_access(p_business_id, p_actor_app_user_id);
  select b.custom_tracking_code into v_code
  from mediasis.businesses b
  where b.uid = p_business_id and coalesce(b.active, true);
  if not found then raise exception 'Business not found'; end if;
  return jsonb_build_object('success', true, 'custom_tracking_code', coalesce(v_code, ''));
end;
$$;

create or replace function mediasis.update_dashboard_custom_tracking_code(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_custom_tracking_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_before text;
begin
  perform mediasis.require_dashboard_developer_access(p_business_id, p_actor_app_user_id);
  if octet_length(coalesce(p_custom_tracking_code, '')) > 51200 then
    raise exception 'Custom tracking code exceeds 50 KB';
  end if;
  select b.custom_tracking_code into v_before
  from mediasis.businesses b where b.uid = p_business_id for update;
  if not found then raise exception 'Business not found'; end if;
  update mediasis.businesses
  set custom_tracking_code = nullif(p_custom_tracking_code, '')
  where uid = p_business_id;
  insert into mediasis.authorization_audit_log (
    actor_app_user_id, business_id, action, target_type, target_id, before_value, after_value
  ) values (
    p_actor_app_user_id, p_business_id, 'developer.custom_tracking_code.updated',
    'business', p_business_id::text,
    jsonb_build_object('configured', v_before is not null),
    jsonb_build_object('configured', nullif(p_custom_tracking_code, '') is not null)
  );
  return jsonb_build_object('success', true);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

create or replace function mediasis.get_dashboard_business_webhooks(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform mediasis.require_dashboard_developer_access(p_business_id, p_actor_app_user_id);
  return jsonb_build_object(
    'success', true,
    'data', coalesce((
      select jsonb_agg(jsonb_build_object(
        'webhook_id', w.webhook_id,
        'endpoint_url', w.endpoint_url,
        'enabled', w.enabled,
        'scope', w.scope,
        'event_types', coalesce((
          select jsonb_agg(e.event_type order by e.event_type)
          from mediasis.business_webhook_event_types e
          where e.webhook_id = w.webhook_id
        ), '[]'::jsonb),
        'location_ids', coalesce((
          select jsonb_agg(l.business_location_id order by l.business_location_id)
          from mediasis.business_webhook_locations l
          where l.webhook_id = w.webhook_id
            and mediasis.developer_actor_can_use_location(
              p_business_id, p_actor_app_user_id, l.business_location_id
            )
        ), '[]'::jsonb),
        'created_at', w.created_at,
        'updated_at', w.updated_at,
        'has_secret', nullif(w.secret_token, '') is not null
      ) order by w.created_at desc)
      from mediasis.business_webhooks w
      where w.business_id = p_business_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function mediasis.create_dashboard_business_webhook(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_endpoint_url text,
  p_encrypted_secret_token text,
  p_event_types text[],
  p_location_ids uuid[],
  p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_webhook_id uuid; v_location uuid; v_event text; v_all_locations boolean;
begin
  perform mediasis.require_dashboard_developer_access(p_business_id, p_actor_app_user_id);
  if p_endpoint_url !~ '^https://[^[:space:]]+$' then raise exception 'Invalid endpoint URL'; end if;
  if nullif(p_encrypted_secret_token, '') is null then raise exception 'Webhook secret is required'; end if;
  if cardinality(coalesce(p_event_types, '{}'::text[])) = 0 then raise exception 'Select at least one event'; end if;
  if exists (select 1 from unnest(p_event_types) e where e <> 'order.paid') then raise exception 'Invalid event type'; end if;

  if p_actor_app_user_id is null then
    v_all_locations := true;
  else
    select bm.all_locations into v_all_locations
    from mediasis.business_memberships bm
    where bm.business_id = p_business_id and bm.app_user_id = p_actor_app_user_id
      and bm.status = 'active' and bm.revoked_at is null;
  end if;
  if cardinality(coalesce(p_location_ids, '{}'::uuid[])) = 0 and not coalesce(v_all_locations, false) then
    raise exception 'You cannot create an all-location webhook';
  end if;
  foreach v_location in array coalesce(p_location_ids, '{}'::uuid[]) loop
    if not mediasis.developer_actor_can_use_location(p_business_id, p_actor_app_user_id, v_location) then
      raise exception 'Not authorized';
    end if;
  end loop;

  insert into mediasis.business_webhooks (
    business_id, endpoint_url, secret_token, enabled, scope
  ) values (
    p_business_id, p_endpoint_url, p_encrypted_secret_token, coalesce(p_enabled, true),
    case when cardinality(coalesce(p_location_ids, '{}'::uuid[])) = 0
      then 'all'::mediasis.scope else 'specific'::mediasis.scope end
  ) returning webhook_id into v_webhook_id;

  foreach v_event in array p_event_types loop
    insert into mediasis.business_webhook_event_types (webhook_id, event_type)
    values (v_webhook_id, v_event);
  end loop;
  foreach v_location in array coalesce(p_location_ids, '{}'::uuid[]) loop
    insert into mediasis.business_webhook_locations (webhook_id, business_location_id)
    values (v_webhook_id, v_location);
  end loop;
  insert into mediasis.authorization_audit_log (
    actor_app_user_id, business_id, action, target_type, target_id, after_value
  ) values (
    p_actor_app_user_id, p_business_id, 'developer.webhook.created',
    'business_webhook', v_webhook_id::text,
    jsonb_build_object('endpoint_url', p_endpoint_url, 'enabled', coalesce(p_enabled, true))
  );
  return jsonb_build_object('success', true, 'webhook_id', v_webhook_id);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

create or replace function mediasis.rotate_dashboard_business_webhook_secret(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_webhook_id uuid,
  p_encrypted_secret_token text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform mediasis.require_dashboard_developer_access(p_business_id, p_actor_app_user_id);
  if nullif(p_encrypted_secret_token, '') is null then raise exception 'Webhook secret is required'; end if;
  update mediasis.business_webhooks
  set secret_token = p_encrypted_secret_token, updated_at = now()
  where webhook_id = p_webhook_id and business_id = p_business_id;
  if not found then raise exception 'Webhook not found'; end if;
  insert into mediasis.authorization_audit_log (
    actor_app_user_id, business_id, action, target_type, target_id
  ) values (
    p_actor_app_user_id, p_business_id, 'developer.webhook.secret_rotated',
    'business_webhook', p_webhook_id::text
  );
  return jsonb_build_object('success', true);
exception when others then return jsonb_build_object('success', false, 'message', sqlerrm); end;
$$;

create or replace function mediasis.delete_dashboard_business_webhook(
  p_business_id uuid,
  p_actor_app_user_id uuid,
  p_webhook_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform mediasis.require_dashboard_developer_access(p_business_id, p_actor_app_user_id);
  if not exists (
    select 1 from mediasis.business_webhooks w
    where w.webhook_id = p_webhook_id and w.business_id = p_business_id
  ) then raise exception 'Webhook not found'; end if;
  delete from mediasis.business_webhook_locations where webhook_id = p_webhook_id;
  delete from mediasis.business_webhook_event_types where webhook_id = p_webhook_id;
  delete from mediasis.business_webhooks
  where webhook_id = p_webhook_id and business_id = p_business_id;
  insert into mediasis.authorization_audit_log (
    actor_app_user_id, business_id, action, target_type, target_id
  ) values (
    p_actor_app_user_id, p_business_id, 'developer.webhook.deleted',
    'business_webhook', p_webhook_id::text
  );
  return jsonb_build_object('success', true);
exception when others then return jsonb_build_object('success', false, 'message', sqlerrm); end;
$$;

create or replace function mediasis.get_business_developer_permission_catalog(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_roles jsonb;
begin
  perform mediasis.team_require_permission(p_business_id, p_actor_app_user_id, 'members.read');
  select coalesce(jsonb_object_agg(br.business_role_id::text, coalesce(keys.permission_keys, '[]'::jsonb)), '{}'::jsonb)
  into v_roles
  from mediasis.business_roles br
  left join lateral (
    select jsonb_agg(brp.permission_key) permission_keys
    from mediasis.business_role_permissions brp
    where brp.business_role_id = br.business_role_id
      and brp.permission_key = 'developer.manage.full'
      and brp.revoked_at is null
  ) keys on true
  where br.business_id = p_business_id and br.active and br.archived_at is null;
  return jsonb_build_object(
    'success', true,
    'permissions', jsonb_build_array(jsonb_build_object(
      'key', 'developer.manage.full',
      'name', 'Administrar herramientas de desarrollador',
      'description', 'Administrar scripts personalizados y webhooks.'
    )),
    'role_permissions', v_roles
  );
end;
$$;

revoke all on function mediasis.require_dashboard_developer_access(uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.developer_actor_can_use_location(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.get_dashboard_custom_tracking_code(uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.update_dashboard_custom_tracking_code(uuid, uuid, text) from public, anon, authenticated;
revoke all on function mediasis.get_dashboard_business_webhooks(uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.create_dashboard_business_webhook(uuid, uuid, text, text, text[], uuid[], boolean) from public, anon, authenticated;
revoke all on function mediasis.rotate_dashboard_business_webhook_secret(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function mediasis.delete_dashboard_business_webhook(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function mediasis.get_business_developer_permission_catalog(uuid, uuid) from public, anon, authenticated;

grant execute on function mediasis.require_dashboard_developer_access(uuid, uuid) to service_role;
grant execute on function mediasis.developer_actor_can_use_location(uuid, uuid, uuid) to service_role;
grant execute on function mediasis.get_dashboard_custom_tracking_code(uuid, uuid) to service_role;
grant execute on function mediasis.update_dashboard_custom_tracking_code(uuid, uuid, text) to service_role;
grant execute on function mediasis.get_dashboard_business_webhooks(uuid, uuid) to service_role;
grant execute on function mediasis.create_dashboard_business_webhook(uuid, uuid, text, text, text[], uuid[], boolean) to service_role;
grant execute on function mediasis.rotate_dashboard_business_webhook_secret(uuid, uuid, uuid, text) to service_role;
grant execute on function mediasis.delete_dashboard_business_webhook(uuid, uuid, uuid) to service_role;
grant execute on function mediasis.get_business_developer_permission_catalog(uuid, uuid) to service_role;

commit;
