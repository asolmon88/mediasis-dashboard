-- Migration: 070
-- Purpose: Country-agnostic, business-level market configuration for the dashboard.
-- Apply after migration 069. This file is not applied automatically.

begin;

create table if not exists mediasis.market_country_profiles (
  country_code text primary key,
  country_name text not null,
  default_timezone text not null,
  default_currency_code text not null,
  default_locale text not null,
  phone_country_code text not null,
  map_center_lat numeric,
  map_center_lng numeric,
  map_default_zoom numeric,
  capabilities text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_country_profiles_country_code_format check (country_code ~ '^[A-Z]{2}$'),
  constraint market_country_profiles_currency_code_format check (default_currency_code ~ '^[A-Z]{3}$'),
  constraint market_country_profiles_phone_code_format check (phone_country_code ~ '^[A-Z]{2}$'),
  constraint market_country_profiles_locale_format check (default_locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  constraint market_country_profiles_name_not_blank check (btrim(country_name) <> ''),
  constraint market_country_profiles_timezone_not_blank check (btrim(default_timezone) <> ''),
  constraint market_country_profiles_map_valid check (
    (map_center_lat is null and map_center_lng is null)
    or (map_center_lat between -90 and 90 and map_center_lng between -180 and 180)
  ),
  constraint market_country_profiles_zoom_valid check (map_default_zoom is null or map_default_zoom between 1 and 22)
);

create or replace function mediasis.validate_market_country_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.default_timezone) then
    raise exception 'Unknown IANA timezone: %', new.default_timezone;
  end if;
  if exists (
    select 1 from unnest(new.capabilities) capability
    where capability !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  ) then
    raise exception 'Invalid market capability key';
  end if;
  return new;
end;
$$;

drop trigger if exists market_country_profiles_validate on mediasis.market_country_profiles;
create trigger market_country_profiles_validate
before insert or update on mediasis.market_country_profiles
for each row execute function mediasis.validate_market_country_profile();

insert into mediasis.market_country_profiles (
  country_code, country_name, default_timezone, default_currency_code,
  default_locale, phone_country_code, map_center_lat, map_center_lng,
  map_default_zoom, capabilities, active
) values
  ('CR', 'Costa Rica', 'America/Costa_Rica', 'CRC', 'es-CR', 'CR', 9.932, -84.08, 9, array['invoicing.electronic'], true),
  ('PA', 'Panamá', 'America/Panama', 'USD', 'es-PA', 'PA', 8.9824, -79.5199, 9, '{}', true)
on conflict (country_code) do update set
  country_name = excluded.country_name,
  default_timezone = excluded.default_timezone,
  default_currency_code = excluded.default_currency_code,
  default_locale = excluded.default_locale,
  phone_country_code = excluded.phone_country_code,
  map_center_lat = excluded.map_center_lat,
  map_center_lng = excluded.map_center_lng,
  map_default_zoom = excluded.map_default_zoom,
  capabilities = excluded.capabilities,
  active = excluded.active,
  updated_at = now();

create table if not exists mediasis.business_market_settings (
  business_id uuid primary key references mediasis.businesses(uid) on update cascade on delete restrict,
  country_code text not null references mediasis.market_country_profiles(country_code) on update cascade on delete restrict,
  country_name text not null,
  timezone text not null,
  currency_code text not null,
  locale text not null,
  phone_country_code text not null,
  capabilities text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_market_country_code_format check (country_code ~ '^[A-Z]{2}$'),
  constraint business_market_currency_code_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint business_market_phone_code_format check (phone_country_code ~ '^[A-Z]{2}$'),
  constraint business_market_locale_format check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$')
);

insert into mediasis.business_market_settings (
  business_id, country_code, country_name, timezone, currency_code,
  locale, phone_country_code, capabilities
)
select b.uid, p.country_code, p.country_name, p.default_timezone,
       p.default_currency_code, p.default_locale, p.phone_country_code, p.capabilities
from mediasis.businesses b
cross join mediasis.market_country_profiles p
where p.country_code = 'CR'
on conflict (business_id) do nothing;

create or replace function mediasis.ensure_business_market_settings()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_profile mediasis.market_country_profiles%rowtype;
begin
  select * into strict v_profile from mediasis.market_country_profiles where country_code='CR';
  insert into mediasis.business_market_settings(business_id,country_code,country_name,timezone,currency_code,locale,phone_country_code,capabilities)
  values(new.uid,v_profile.country_code,v_profile.country_name,v_profile.default_timezone,v_profile.default_currency_code,
    v_profile.default_locale,v_profile.phone_country_code,v_profile.capabilities)
  on conflict (business_id) do nothing;
  return new;
end; $$;
drop trigger if exists businesses_ensure_market_settings on mediasis.businesses;
create trigger businesses_ensure_market_settings
after insert on mediasis.businesses for each row execute function mediasis.ensure_business_market_settings();

alter table mediasis.market_country_profiles enable row level security;
alter table mediasis.business_market_settings enable row level security;

insert into mediasis.business_permissions (permission_key, name, description, active, archived_at)
values ('business.market_settings.read', 'Ver configuración regional',
  'View the country, timezone, currency, and locale configured for the active business.', true, null)
on conflict (permission_key) do update set
  name = excluded.name, description = excluded.description,
  active = true, archived_at = null, updated_at = now();

insert into mediasis.business_role_permissions (business_role_id, permission_key, revoked_at)
select br.business_role_id, 'business.market_settings.read', null
from mediasis.business_roles br
where br.role_key = 'business_full_access' and br.active and br.archived_at is null
on conflict (business_role_id, permission_key) do update set revoked_at = null;

create or replace function mediasis.get_business_market_permission_catalog(
  p_business_id uuid,
  p_actor_app_user_id uuid
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role_permissions jsonb;
begin
  perform mediasis.team_require_permission(p_business_id,p_actor_app_user_id,'members.read');
  select coalesce(jsonb_object_agg(br.business_role_id::text,coalesce(keys.permission_keys,'[]'::jsonb)),'{}'::jsonb)
  into v_role_permissions
  from mediasis.business_roles br
  left join lateral (
    select jsonb_agg(brp.permission_key order by brp.permission_key) permission_keys
    from mediasis.business_role_permissions brp
    where brp.business_role_id=br.business_role_id
      and brp.permission_key='business.market_settings.read' and brp.revoked_at is null
  ) keys on true
  where br.business_id=p_business_id and br.active and br.archived_at is null;
  return jsonb_build_object('success',true,'permissions',jsonb_build_array(jsonb_build_object(
    'key','business.market_settings.read','name','Ver configuración regional',
    'description','Ver el país, zona horaria, moneda y configuración regional del negocio.'
  )),'role_permissions',v_role_permissions);
end; $$;

insert into mediasis.staff_permissions (permission_key, name, description, active, archived_at)
values ('businesses.market.correct', 'Corregir configuración regional',
  'Correct a business market before commercial data has been configured.', true, null)
on conflict (permission_key) do update set
  name = excluded.name, description = excluded.description,
  active = true, archived_at = null, updated_at = now();

insert into mediasis.staff_role_permissions (staff_role_id, permission_key, revoked_at)
select sr.staff_role_id, 'businesses.market.correct', null
from mediasis.staff_roles sr
where sr.role_key = 'mediasis_full_access' and sr.active and sr.archived_at is null
on conflict (staff_role_id, permission_key) do update set revoked_at = null;

create or replace function mediasis.staff_actor_has_permission(p_actor_app_user_id uuid, p_permission_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from mediasis.staff_memberships sm
    join mediasis.staff_roles sr on sr.staff_role_id=sm.staff_role_id
    join mediasis.staff_role_permissions srp on srp.staff_role_id=sr.staff_role_id
    join mediasis.staff_permissions sp on sp.permission_key=srp.permission_key
    join mediasis.app_users au on au.app_user_id=sm.app_user_id
    where sm.app_user_id=p_actor_app_user_id and sm.status='active' and sm.revoked_at is null
      and sr.active and sr.archived_at is null and srp.revoked_at is null
      and sp.permission_key=p_permission_key and sp.active and sp.archived_at is null
      and au.status='active' and au.deleted_at is null
  );
$$;

create or replace function mediasis.get_authorized_business_market_settings(
  p_business_id uuid,
  p_actor_app_user_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_settings jsonb;
begin
  if not exists (select 1 from mediasis.businesses b where b.uid=p_business_id and b.active) then
    raise exception 'Active business not found';
  end if;
  if p_actor_app_user_id is not null and not (
    exists (
      select 1 from mediasis.business_memberships bm
      join mediasis.app_users au on au.app_user_id=bm.app_user_id
      where bm.business_id=p_business_id and bm.app_user_id=p_actor_app_user_id
        and bm.status='active' and bm.revoked_at is null
        and au.status='active' and au.deleted_at is null
    )
    or exists (
      select 1 from mediasis.staff_memberships sm
      join mediasis.staff_roles sr on sr.staff_role_id=sm.staff_role_id
      join mediasis.app_users au on au.app_user_id=sm.app_user_id
      where sm.app_user_id=p_actor_app_user_id and sm.status='active' and sm.revoked_at is null
        and sr.active and sr.archived_at is null and au.status='active' and au.deleted_at is null
    )
  ) then raise exception 'Not authorized for this business'; end if;
  select to_jsonb(s) into v_settings from mediasis.business_market_settings s where s.business_id=p_business_id;
  if v_settings is null then return jsonb_build_object('success',false,'message','Business market settings not found'); end if;
  return jsonb_build_object('success',true,'data',v_settings);
end; $$;

alter table mediasis.business_provisioning_requests
  add column if not exists requested_country_code text;
update mediasis.business_provisioning_requests set requested_country_code = 'CR'
where requested_country_code is null;
alter table mediasis.business_provisioning_requests alter column requested_country_code set not null;
alter table mediasis.business_provisioning_requests
  drop constraint if exists business_provisioning_requested_country_fk;
alter table mediasis.business_provisioning_requests
  add constraint business_provisioning_requested_country_fk
  foreign key (requested_country_code) references mediasis.market_country_profiles(country_code)
  on update cascade on delete restrict;

create or replace function mediasis.begin_dashboard_business_provisioning_with_country(
  p_idempotency_key uuid,
  p_business_name text,
  p_location_name text,
  p_phone text,
  p_lat numeric,
  p_lng numeric,
  p_country_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator uuid := mediasis.current_business_app_user_id();
  v_request mediasis.business_provisioning_requests%rowtype;
  v_profile mediasis.market_country_profiles%rowtype;
  v_business_id uuid;
  v_location_id uuid;
  v_role_id uuid;
  v_membership_id uuid;
begin
  if v_creator is null or not mediasis.can_create_business() then raise exception 'No tenés permiso para crear negocios'; end if;
  if p_idempotency_key is null then raise exception 'An idempotency key is required'; end if;
  if btrim(coalesce(p_business_name, '')) = '' or btrim(coalesce(p_location_name, '')) = '' then raise exception 'Business and location names are required'; end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid business coordinates'; end if;

  select * into v_profile from mediasis.market_country_profiles
  where country_code = upper(btrim(p_country_code)) and active;
  if not found then raise exception 'Unsupported or inactive country profile'; end if;

  select * into v_request from mediasis.business_provisioning_requests
  where creator_app_user_id = v_creator and idempotency_key = p_idempotency_key for update;
  if found then
    if v_request.requested_country_code <> v_profile.country_code then
      raise exception 'The provisioning request country cannot be changed during a retry';
    end if;
    if v_request.status = 'failed' then
      update mediasis.business_provisioning_requests
      set status='pending', failed_at=null, last_error=null, updated_at=now()
      where business_provisioning_request_id=v_request.business_provisioning_request_id returning * into v_request;
    end if;
    return jsonb_build_object('success',true,'status',v_request.status,'business_id',v_request.business_id,
      'business_location_id',v_request.business_location_id,'clerk_organization_id',v_request.clerk_organization_id,
      'message',v_request.last_error);
  end if;

  v_business_id := gen_random_uuid(); v_location_id := gen_random_uuid();
  insert into mediasis.businesses(uid,full_name,active,app_active,hub_visible)
  values(v_business_id,btrim(p_business_name),false,false,false);
  insert into mediasis.business_market_settings(business_id,country_code,country_name,timezone,currency_code,locale,phone_country_code,capabilities)
  values(v_business_id,v_profile.country_code,v_profile.country_name,v_profile.default_timezone,
    v_profile.default_currency_code,v_profile.default_locale,v_profile.phone_country_code,v_profile.capabilities)
  on conflict (business_id) do update set country_code=excluded.country_code,country_name=excluded.country_name,
    timezone=excluded.timezone,currency_code=excluded.currency_code,locale=excluded.locale,
    phone_country_code=excluded.phone_country_code,capabilities=excluded.capabilities,updated_at=now();
  insert into mediasis.business_location(business_uid,business_location_id,short_name,phone_number,lat,lng)
  values(v_business_id,v_location_id,btrim(p_location_name),btrim(p_phone),p_lat,p_lng);
  insert into mediasis.business_roles(business_id,role_key,name,description,role_origin,is_editable)
  values(v_business_id,'business_full_access','Full access','Mediasis-managed role with every active business permission.',
    'system'::mediasis.business_role_origin,false) returning business_role_id into v_role_id;
  insert into mediasis.business_role_permissions(business_role_id,permission_key)
  select v_role_id,permission_key from mediasis.business_permissions where active;
  insert into mediasis.business_memberships(business_id,app_user_id,status,revoked_at,all_locations)
  values(v_business_id,v_creator,'active',null,true) returning business_membership_id into v_membership_id;
  insert into mediasis.business_membership_roles(business_membership_id,business_role_id,business_id,revoked_at)
  values(v_membership_id,v_role_id,v_business_id,null);
  insert into mediasis.business_provisioning_requests(creator_app_user_id,idempotency_key,requested_business_name,
    requested_location_name,requested_phone,requested_lat,requested_lng,requested_country_code,
    business_id,business_location_id,status)
  values(v_creator,p_idempotency_key,btrim(p_business_name),btrim(p_location_name),btrim(p_phone),p_lat,p_lng,
    v_profile.country_code,v_business_id,v_location_id,'pending') returning * into v_request;
  return jsonb_build_object('success',true,'status',v_request.status,'business_id',v_business_id,
    'business_location_id',v_location_id,'clerk_organization_id',null);
end;
$$;

create or replace function mediasis.correct_business_market_settings(
  p_business_id uuid,
  p_country_code text,
  p_reason text,
  p_actor_app_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile mediasis.market_country_profiles%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if not mediasis.staff_actor_has_permission(p_actor_app_user_id,'businesses.market.correct') then raise exception 'Not authorized'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'A correction reason is required'; end if;
  select to_jsonb(s) into v_before from mediasis.business_market_settings s where business_id=p_business_id for update;
  if v_before is null then raise exception 'Business market settings not found'; end if;
  select * into v_profile from mediasis.market_country_profiles where country_code=upper(btrim(p_country_code)) and active;
  if not found then raise exception 'Unsupported or inactive country profile'; end if;
  if (v_before->>'country_code' <> v_profile.country_code or v_before->>'currency_code' <> v_profile.default_currency_code) and (
    exists(select 1 from mediasis.product where business=p_business_id)
    or exists(select 1 from mediasis.orders o join mediasis.business_location bl on bl.business_location_id=o.business_location_id where bl.business_uid=p_business_id)
    or exists(select 1 from mediasis.discounts where business_uid=p_business_id)
    or exists(select 1 from mediasis.discount_code where business_uid=p_business_id)
    or exists(select 1 from mediasis.order_cashback where business_uid=p_business_id)
    or exists(select 1 from mediasis.cashback_events where business_uid=p_business_id)
    or exists(select 1 from mediasis.business_cashback_settings where business_uid=p_business_id and enabled)
    or exists(select 1 from mediasis.delivery_methods_business where business_id=p_business_id and case
      when jsonb_typeof(fee)='number' then (fee::text)::numeric
      when jsonb_typeof(fee)='object' then coalesce(nullif(fee->>'price','')::numeric,0)
      else 0 end <> 0)
    or exists(select 1 from mediasis.business_payment_processor where business_id=p_business_id)
    or exists(select 1 from mediasis.onvo_keys where business_id=p_business_id)
  )
  then raise exception 'Market correction requires a dedicated commercial-data migration'; end if;
  update mediasis.business_market_settings set country_code=v_profile.country_code,country_name=v_profile.country_name,
    timezone=v_profile.default_timezone,currency_code=v_profile.default_currency_code,locale=v_profile.default_locale,
    phone_country_code=v_profile.phone_country_code,capabilities=v_profile.capabilities,updated_at=now()
  where business_id=p_business_id;
  select to_jsonb(s) into v_after from mediasis.business_market_settings s where s.business_id=p_business_id;
  insert into mediasis.authorization_audit_log(actor_app_user_id,business_id,action,target_type,target_id,before_value,after_value,source)
  values(p_actor_app_user_id,p_business_id,'business.market.correct','business_market_settings',p_business_id::text,
    v_before,v_after || jsonb_build_object('reason',btrim(p_reason)),'application');
  return jsonb_build_object('success',true,'data',v_after);
end;
$$;

create or replace function mediasis.current_business_timezone()
returns text language sql stable security definer set search_path='' as $$
  select s.timezone from mediasis.business_market_settings s
  where s.business_id=mediasis.current_legacy_business_id();
$$;

-- The legacy seven-argument analytics function is also used by the authorized
-- wrapper after temporarily setting the business subject. Preserve its API but
-- replace its only fixed market assumption with the business resolver.
do $$
declare v_definition text; v_updated text;
begin
  select pg_catalog.pg_get_functiondef(
    'mediasis.get_business_home_dashboard(timestamptz,timestamptz,date,date,uuid,boolean,text)'::regprocedure
  ) into v_definition;
  v_updated := pg_catalog.replace(v_definition, '''America/Costa_Rica''', 'mediasis.current_business_timezone()');
  if v_updated = v_definition and pg_catalog.strpos(v_definition, 'mediasis.current_business_timezone()') = 0 then
    raise exception 'Expected analytics timezone literal was not found';
  end if;
  if v_updated = v_definition then return; end if;
  execute v_updated;
end; $$;

create or replace function mediasis.get_business_home_dashboard_for_local_dates(
  p_start_local_day date, p_end_local_day date, p_location_id uuid,
  p_include_all_locations boolean, p_bucket text, p_requested_business_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_timezone text; v_start timestamptz; v_end timestamptz;
begin
  select timezone into v_timezone from mediasis.business_market_settings where business_id=p_requested_business_id;
  if v_timezone is null then return jsonb_build_object('success',false,'message','El negocio no tiene configuración regional.'); end if;
  v_start := p_start_local_day::timestamp at time zone v_timezone;
  v_end := (p_end_local_day + 1)::timestamp at time zone v_timezone;
  return mediasis.get_business_home_dashboard(v_start,v_end,p_start_local_day,p_end_local_day,
    p_location_id,p_include_all_locations,p_bucket,p_requested_business_id);
end; $$;

revoke all on table mediasis.market_country_profiles from public,anon,authenticated;
revoke all on table mediasis.business_market_settings from public,anon,authenticated;
revoke all on function mediasis.validate_market_country_profile() from public,anon,authenticated;
revoke all on function mediasis.ensure_business_market_settings() from public,anon,authenticated;
grant select on table mediasis.market_country_profiles to service_role;
grant select,insert,update on table mediasis.business_market_settings to service_role;
revoke all on function mediasis.begin_dashboard_business_provisioning_with_country(uuid,text,text,text,numeric,numeric,text) from public,anon;
grant execute on function mediasis.begin_dashboard_business_provisioning_with_country(uuid,text,text,text,numeric,numeric,text) to authenticated,service_role;
revoke all on function mediasis.correct_business_market_settings(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function mediasis.correct_business_market_settings(uuid,text,text,uuid) to service_role;
revoke all on function mediasis.staff_actor_has_permission(uuid,text) from public,anon,authenticated;
grant execute on function mediasis.staff_actor_has_permission(uuid,text) to service_role;
revoke all on function mediasis.get_authorized_business_market_settings(uuid,uuid) from public,anon,authenticated;
grant execute on function mediasis.get_authorized_business_market_settings(uuid,uuid) to service_role;
revoke all on function mediasis.get_business_market_permission_catalog(uuid,uuid) from public,anon,authenticated;
grant execute on function mediasis.get_business_market_permission_catalog(uuid,uuid) to service_role;
revoke all on function mediasis.get_business_home_dashboard_for_local_dates(date,date,uuid,boolean,text,uuid) from public,anon;
grant execute on function mediasis.get_business_home_dashboard_for_local_dates(date,date,uuid,boolean,text,uuid) to authenticated,service_role;
revoke all on function mediasis.current_business_timezone() from public,anon,authenticated;
grant execute on function mediasis.current_business_timezone() to service_role;

comment on table mediasis.market_country_profiles is 'Extensible dashboard market presets; adding a country does not require schema changes.';
comment on table mediasis.business_market_settings is 'Immutable-by-default snapshot of one business country, timezone, currency, locale, and capabilities.';

commit;
