-- Migration: 023
-- Global saved locations for authenticated Mediasis consumers.
-- Draft only: review and apply explicitly after migration 022.

begin;

create table if not exists mediasis.consumer_saved_locations (
  consumer_saved_location_id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  name text,
  latitude double precision not null,
  longitude double precision not null,
  google_global_code text,
  google_compound_code text,
  formatted_address text,
  google_place_id text,
  is_current boolean not null default false,
  last_used_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consumer_saved_locations_latitude_valid check (latitude between -90 and 90),
  constraint consumer_saved_locations_longitude_valid check (longitude between -180 and 180),
  constraint consumer_saved_locations_name_valid check (name is null or btrim(name) <> ''),
  constraint consumer_saved_locations_global_code_valid check (google_global_code is null or btrim(google_global_code) <> ''),
  constraint consumer_saved_locations_compound_code_valid check (google_compound_code is null or btrim(google_compound_code) <> ''),
  constraint consumer_saved_locations_current_active check (not is_current or deleted_at is null)
);

create unique index if not exists consumer_saved_locations_one_current
  on mediasis.consumer_saved_locations (app_user_id)
  where is_current and deleted_at is null;
create index if not exists consumer_saved_locations_owner_active
  on mediasis.consumer_saved_locations (app_user_id, last_used_at desc, created_at desc)
  where deleted_at is null;

alter table mediasis.consumer_saved_locations enable row level security;

-- Consumers may read only their own active saved locations. All mutations stay
-- behind the ownership-validating SECURITY DEFINER functions below so callers
-- cannot set app_user_id, is_current, deletion timestamps, or usage metadata.
drop policy if exists consumer_saved_locations_select_own
  on mediasis.consumer_saved_locations;
create policy consumer_saved_locations_select_own
  on mediasis.consumer_saved_locations
  for select
  to authenticated
  using (
    app_user_id = mediasis.current_app_user_id()
    and deleted_at is null
  );

create or replace function mediasis.get_my_saved_locations()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.consumer_saved_location_id,
    'name', l.name,
    'latitude', l.latitude,
    'longitude', l.longitude,
    'google_global_code', l.google_global_code,
    'google_compound_code', l.google_compound_code,
    'formatted_address', l.formatted_address,
    'google_place_id', l.google_place_id,
    'is_current', l.is_current,
    'last_used_at', l.last_used_at,
    'created_at', l.created_at
  ) order by l.is_current desc, l.last_used_at desc nulls last, l.created_at desc), '[]'::jsonb)
  from mediasis.consumer_saved_locations l
  where l.app_user_id = mediasis.current_app_user_id() and l.deleted_at is null;
$$;

create or replace function mediasis.create_my_saved_location(
  p_name text, p_latitude double precision, p_longitude double precision,
  p_google_global_code text default null, p_google_compound_code text default null,
  p_formatted_address text default null, p_google_place_id text default null,
  p_make_current boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := mediasis.current_app_user_id();
  v_id uuid;
  v_make_current boolean;
begin
  if v_user is null then return jsonb_build_object('success', false, 'code', 'not_authenticated', 'message', 'Not authenticated.'); end if;
  if p_name is null or btrim(p_name) = '' or length(btrim(p_name)) > 80 then
    return jsonb_build_object('success', false, 'code', 'invalid_name', 'message', 'Invalid location name.');
  end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    return jsonb_build_object('success', false, 'code', 'invalid_coordinates', 'message', 'Invalid coordinates.');
  end if;
  perform 1 from mediasis.app_users u where u.app_user_id = v_user and u.status = 'active' and u.deleted_at is null for update;
  if not found then return jsonb_build_object('success', false, 'code', 'inactive_user', 'message', 'Inactive account.'); end if;
  if (select count(*) from mediasis.consumer_saved_locations where app_user_id = v_user and deleted_at is null) >= 5 then
    return jsonb_build_object('success', false, 'code', 'location_limit', 'message', 'You can save up to five locations.');
  end if;
  v_make_current := p_make_current or not exists (
    select 1 from mediasis.consumer_saved_locations where app_user_id = v_user and deleted_at is null and is_current
  );
  if v_make_current then
    update mediasis.consumer_saved_locations set is_current = false, updated_at = now()
    where app_user_id = v_user and deleted_at is null and is_current;
  end if;
  insert into mediasis.consumer_saved_locations (
    app_user_id, name, latitude, longitude, google_global_code, google_compound_code,
    formatted_address, google_place_id, is_current, last_used_at
  ) values (
    v_user, btrim(p_name), p_latitude, p_longitude,
    nullif(btrim(p_google_global_code), ''), nullif(btrim(p_google_compound_code), ''),
    nullif(btrim(p_formatted_address), ''), nullif(btrim(p_google_place_id), ''),
    v_make_current, case when v_make_current then now() else null end
  ) returning consumer_saved_location_id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function mediasis.rename_my_saved_location(p_location_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_name is null or btrim(p_name) = '' or length(btrim(p_name)) > 80 then
    return jsonb_build_object('success', false, 'code', 'invalid_name', 'message', 'Invalid location name.');
  end if;
  update mediasis.consumer_saved_locations set name = btrim(p_name), updated_at = now()
  where consumer_saved_location_id = p_location_id and app_user_id = mediasis.current_app_user_id() and deleted_at is null;
  return jsonb_build_object('success', found, 'message', case when found then null else 'Location not found.' end);
end;
$$;

create or replace function mediasis.set_my_current_location(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := mediasis.current_app_user_id();
begin
  if not exists (select 1 from mediasis.consumer_saved_locations where consumer_saved_location_id = p_location_id and app_user_id = v_user and deleted_at is null) then
    return jsonb_build_object('success', false, 'message', 'Location not found.');
  end if;
  update mediasis.consumer_saved_locations set is_current = false, updated_at = now()
  where app_user_id = v_user and deleted_at is null and is_current;
  update mediasis.consumer_saved_locations set is_current = true, last_used_at = now(), updated_at = now()
  where consumer_saved_location_id = p_location_id and app_user_id = v_user and deleted_at is null;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function mediasis.delete_my_saved_location(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := mediasis.current_app_user_id(); v_was_current boolean; v_replacement uuid;
begin
  select is_current into v_was_current from mediasis.consumer_saved_locations
  where consumer_saved_location_id = p_location_id and app_user_id = v_user and deleted_at is null for update;
  if not found then return jsonb_build_object('success', false, 'message', 'Location not found.'); end if;
  update mediasis.consumer_saved_locations set is_current = false, deleted_at = now(), updated_at = now()
  where consumer_saved_location_id = p_location_id and app_user_id = v_user;
  if v_was_current then
    select consumer_saved_location_id into v_replacement from mediasis.consumer_saved_locations
    where app_user_id = v_user and deleted_at is null
    order by last_used_at desc nulls last, created_at desc limit 1 for update;
    if v_replacement is not null then
      update mediasis.consumer_saved_locations set is_current = true, last_used_at = now(), updated_at = now()
      where consumer_saved_location_id = v_replacement;
    end if;
  end if;
  return jsonb_build_object('success', true, 'current_location_id', v_replacement);
end;
$$;

revoke all on table mediasis.consumer_saved_locations from public, anon, authenticated;
grant select on table mediasis.consumer_saved_locations to authenticated;
revoke all on function mediasis.get_my_saved_locations() from public;
revoke all on function mediasis.create_my_saved_location(text,double precision,double precision,text,text,text,text,boolean) from public;
revoke all on function mediasis.rename_my_saved_location(uuid,text) from public;
revoke all on function mediasis.set_my_current_location(uuid) from public;
revoke all on function mediasis.delete_my_saved_location(uuid) from public;
grant execute on function mediasis.get_my_saved_locations() to authenticated;
grant execute on function mediasis.create_my_saved_location(text,double precision,double precision,text,text,text,text,boolean) to authenticated;
grant execute on function mediasis.rename_my_saved_location(uuid,text) to authenticated;
grant execute on function mediasis.set_my_current_location(uuid) to authenticated;
grant execute on function mediasis.delete_my_saved_location(uuid) to authenticated;

commit;
