-- Daily preparation reset. Apply after dashboard_automatic_statuses_authorization
-- and dashboard_multicountry_market_configuration, before deploying the UI.
-- No existing business is opted in by this migration.
begin;

create table mediasis.daily_preparation_reset_config (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references mediasis.businesses(uid) on update cascade on delete cascade,
  business_location_id uuid references mediasis.business_location(business_location_id) on update cascade on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index daily_preparation_reset_global_unique
  on mediasis.daily_preparation_reset_config(business_id) where business_location_id is null;
create unique index daily_preparation_reset_location_unique
  on mediasis.daily_preparation_reset_config(business_id, business_location_id) where business_location_id is not null;

-- Absence of an override means 10 minutes, including for future methods.
create table mediasis.daily_preparation_reset_method_values (
  business_delivery_method_id uuid primary key references mediasis.delivery_methods_business(uid) on update cascade on delete cascade,
  reset_minutes integer not null check (reset_minutes between 1 and 180),
  updated_at timestamptz not null default now()
);
create table mediasis.daily_preparation_reset_location_state (
  business_location_id uuid primary key references mediasis.business_location(business_location_id) on update cascade on delete cascade,
  last_processed_local_date date not null,
  updated_at timestamptz not null default now()
);
-- Aggregate actionable outcomes per business/day/status, rather than logging
-- an idle row every minute. Failed retries update attempts and the latest error.
create table mediasis.daily_preparation_reset_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references mediasis.businesses(uid) on update cascade on delete cascade,
  local_date date not null,
  timezone text,
  status text not null check (status in ('completed', 'failed')),
  location_count integer not null default 0,
  affected_row_count integer not null default 0,
  attempts integer not null default 1,
  error_message text,
  updated_at timestamptz not null default now(),
  unique (business_id, local_date, status)
);

create function mediasis.daily_preparation_reset_active_locations(p_business_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select bl.business_location_id from mediasis.business_location bl
  where bl.business_uid = p_business_id and exists (
    select 1 from mediasis.daily_preparation_reset_config c
    where c.business_id = p_business_id and c.enabled
      and (c.business_location_id is null or c.business_location_id = bl.business_location_id)
  );
$$;

create function mediasis.get_dashboard_daily_preparation_reset_settings(
  p_business_id uuid, p_actor_app_user_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_access jsonb;
  v_all boolean;
  v_allowed uuid[];
  v_global boolean;
  v_everywhere boolean;
  v_enabled boolean;
  v_selected uuid[];
  v_methods jsonb;
  v_timezone text;
begin
  -- Reuse the existing permission and location-scoped membership checks.
  v_access := mediasis.get_dashboard_automatic_status_settings(p_business_id, p_actor_app_user_id);
  v_all := mediasis.dashboard_automatic_statuses_actor_all_locations(p_business_id, p_actor_app_user_id);
  select coalesce(array_agg((l->>'business_location_id')::uuid), '{}'::uuid[]) into v_allowed
  from jsonb_array_elements(v_access->'data'->'locations') l;
  select exists(select 1 from mediasis.daily_preparation_reset_config
    where business_id = p_business_id and business_location_id is null and enabled) into v_global;
  select coalesce(bool_or(enabled), false) into v_enabled
  from mediasis.daily_preparation_reset_config
  where business_id = p_business_id and business_location_id = any(v_allowed);
  -- When scopes have mixed enabled/disabled rows, display only the active
  -- selection. Otherwise changing a method value could accidentally re-enable
  -- a location that another authorized editor explicitly disabled.
  select coalesce(array_agg(business_location_id order by business_location_id), '{}'::uuid[]) into v_selected
  from mediasis.daily_preparation_reset_config
  where business_id = p_business_id and business_location_id = any(v_allowed)
    and (enabled or not v_enabled);
  v_enabled := v_global or v_enabled;
  v_everywhere := v_global or (v_all and cardinality(v_selected) = 0);
  select timezone into v_timezone from mediasis.business_market_settings where business_id = p_business_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.uid, 'name', m.name,
    'reset_minutes', coalesce(rv.reset_minutes, 10),
    'uses_default', rv.business_delivery_method_id is null,
    'available_everywhere', m.scope = 'all',
    'location_ids', to_jsonb(array(select ml.business_location_id
      from mediasis.delivery_methods_business_location ml
      where ml.delivery_methods_business_id = m.uid and ml.business_location_id = any(v_allowed))),
    'can_edit', v_all or (m.scope = 'specific' and not exists (
      select 1 from mediasis.delivery_methods_business_location ml
      where ml.delivery_methods_business_id = m.uid and not (ml.business_location_id = any(v_allowed))
    ))
  ) order by m.name, m.uid), '[]'::jsonb) into v_methods
  from mediasis.delivery_methods_business m
  left join mediasis.daily_preparation_reset_method_values rv on rv.business_delivery_method_id = m.uid
  where m.business_id = p_business_id and (v_all or (m.scope = 'all' and cardinality(v_allowed) > 0) or exists (
    select 1 from mediasis.delivery_methods_business_location ml
    where ml.delivery_methods_business_id = m.uid and ml.business_location_id = any(v_allowed)
  ));
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'enabled', v_enabled, 'available_everywhere', v_everywhere,
    'global_configuration_active', v_global, 'can_manage_all_locations', v_all,
    'selected_location_ids', to_jsonb(v_selected), 'locations', v_access->'data'->'locations',
    'timezone', v_timezone, 'timezone_valid', exists(select 1 from pg_catalog.pg_timezone_names where name = v_timezone),
    'methods', v_methods
  ));
end;
$$;

create function mediasis.save_dashboard_daily_preparation_reset_settings(
  p_business_id uuid, p_actor_app_user_id uuid, p_enabled boolean,
  p_available_everywhere boolean, p_location_ids uuid[], p_method_values jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb;
  v_before jsonb;
  v_all boolean;
  v_allowed uuid[];
  v_before_locations uuid[];
  v_timezone text;
  v_today date;
  v_value jsonb;
  v_method jsonb;
  v_method_id uuid;
  v_minutes integer;
begin
  perform mediasis.require_dashboard_automatic_statuses_access(p_business_id, p_actor_app_user_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('daily-preparation-reset:' || p_business_id::text, 0));
  v_settings := mediasis.get_dashboard_daily_preparation_reset_settings(p_business_id, p_actor_app_user_id)->'data';
  v_before := v_settings;
  v_all := (v_settings->>'can_manage_all_locations')::boolean;
  if p_enabled is null or p_available_everywhere is null or p_location_ids is null
    or p_method_values is null or jsonb_typeof(p_method_values) <> 'array' then
    raise exception 'Invalid reset configuration';
  end if;
  if cardinality(p_location_ids) > 100 or jsonb_array_length(p_method_values) > 1000 then
    raise exception 'Invalid reset configuration';
  end if;
  select coalesce(array_agg((l->>'business_location_id')::uuid), '{}'::uuid[]) into v_allowed
  from jsonb_array_elements(v_settings->'locations') l;
  if exists(select 1 from unnest(p_location_ids) id where id is null or not (id = any(v_allowed))) then
    raise exception 'Not authorized';
  end if;
  if not v_all and (p_available_everywhere or (v_settings->>'global_configuration_active')::boolean) then
    raise exception 'Cannot change global configuration without all-location access';
  end if;
  if p_enabled and not p_available_everywhere and cardinality(p_location_ids) = 0 then
    raise exception 'Select at least one business location';
  end if;
  v_timezone := v_settings->>'timezone';
  if p_enabled then
    if not (v_settings->>'timezone_valid')::boolean then raise exception 'Invalid business market timezone'; end if;
    v_today := (now() at time zone v_timezone)::date;
  end if;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_before_locations
  from mediasis.daily_preparation_reset_active_locations(p_business_id) id;

  -- Values are a patch: omitted methods are preserved. Null restores the default.
  if exists (select 1 from jsonb_array_elements(p_method_values) v group by v->>'id' having count(*) > 1) then
    raise exception 'Duplicate delivery method';
  end if;
  for v_value in select value from jsonb_array_elements(p_method_values) loop
    if jsonb_typeof(v_value) <> 'object' or not (v_value ? 'reset_minutes') then
      raise exception 'Invalid reset minutes';
    end if;
    v_method_id := (v_value->>'id')::uuid;
    select m into v_method from jsonb_array_elements(v_settings->'methods') m where (m->>'id')::uuid = v_method_id;
    if v_method is null or not (v_method->>'can_edit')::boolean then raise exception 'Not authorized'; end if;
    -- Lock the method to serialize with delivery-method scope edits/deletion.
    perform 1 from mediasis.delivery_methods_business where uid = v_method_id and business_id = p_business_id for update;
    if not found then raise exception 'Not authorized'; end if;
    -- Recheck after acquiring the row lock: the method's assignments may have changed.
    if not v_all and exists (
      select 1 from mediasis.delivery_methods_business m where m.uid = v_method_id and
        (m.scope = 'all' or exists (select 1 from mediasis.delivery_methods_business_location ml
          where ml.delivery_methods_business_id = m.uid and not (ml.business_location_id = any(v_allowed))))
    ) then raise exception 'Not authorized'; end if;
    if v_value->'reset_minutes' = 'null'::jsonb then
      delete from mediasis.daily_preparation_reset_method_values where business_delivery_method_id = v_method_id;
    else
      if jsonb_typeof(v_value->'reset_minutes') <> 'number'
        or (v_value->>'reset_minutes')::numeric <> trunc((v_value->>'reset_minutes')::numeric)
        or (v_value->>'reset_minutes')::numeric not between 1 and 180 then
        raise exception 'Invalid reset minutes';
      end if;
      v_minutes := (v_value->>'reset_minutes')::integer;
      insert into mediasis.daily_preparation_reset_method_values(business_delivery_method_id, reset_minutes)
      values(v_method_id, v_minutes) on conflict(business_delivery_method_id) do update
        set reset_minutes = excluded.reset_minutes, updated_at = now();
    end if;
  end loop;

  delete from mediasis.daily_preparation_reset_config
  where business_id = p_business_id and (v_all or business_location_id = any(v_allowed));
  if p_available_everywhere then
    insert into mediasis.daily_preparation_reset_config(business_id, enabled) values(p_business_id, p_enabled);
  else
    insert into mediasis.daily_preparation_reset_config(business_id, business_location_id, enabled)
    select p_business_id, id, p_enabled from (select distinct unnest(p_location_ids) id) ids;
  end if;
  if p_enabled then
    insert into mediasis.daily_preparation_reset_location_state(business_location_id, last_processed_local_date)
    select id, v_today from mediasis.daily_preparation_reset_active_locations(p_business_id) id
    where not (id = any(v_before_locations))
    on conflict(business_location_id) do update set
      last_processed_local_date = greatest(daily_preparation_reset_location_state.last_processed_local_date, excluded.last_processed_local_date),
      updated_at = now();
  end if;
  insert into mediasis.authorization_audit_log(actor_app_user_id, business_id, action, target_type, target_id, before_value, after_value)
  values(p_actor_app_user_id, p_business_id, 'dashboard_app.daily_preparation_reset.updated',
    'daily_preparation_reset_config', p_business_id::text, v_before,
    mediasis.get_dashboard_daily_preparation_reset_settings(p_business_id, p_actor_app_user_id)->'data');
  return mediasis.get_dashboard_daily_preparation_reset_settings(p_business_id, p_actor_app_user_id);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

-- New locations under a global opt-in wait until their next local day, even if
-- the cron is temporarily unavailable on the day the location is created.
create function mediasis.initialize_daily_preparation_reset_location()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_timezone text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('daily-preparation-reset:' || new.business_uid::text, 0));
  if exists(select 1 from mediasis.daily_preparation_reset_config
    where business_id = new.business_uid and business_location_id is null and enabled) then
    select s.timezone into v_timezone from mediasis.business_market_settings s
      join pg_catalog.pg_timezone_names z on z.name = s.timezone where s.business_id = new.business_uid;
    if v_timezone is not null then
      insert into mediasis.daily_preparation_reset_location_state(business_location_id, last_processed_local_date)
      values(new.business_location_id, (now() at time zone v_timezone)::date) on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
create trigger initialize_daily_preparation_reset_location
after insert on mediasis.business_location for each row execute function mediasis.initialize_daily_preparation_reset_location();

create function mediasis.run_daily_preparation_reset(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
  v_timezone text;
  v_today date;
  v_due uuid[];
  v_rows integer;
  v_total_rows integer := 0;
  v_total_locations integer := 0;
  v_failures integer := 0;
begin
  if p_now is null then raise exception 'Reset timestamp is required'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('mediasis.run_daily_preparation_reset', 0)) then
    return jsonb_build_object('success', true, 'status', 'skipped_locked');
  end if;
  for v_business in select distinct business_id from mediasis.daily_preparation_reset_config where enabled order by business_id loop
    v_timezone := null;
    v_today := null;
    begin
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('daily-preparation-reset:' || v_business::text, 0));
      -- A save may have disabled this business while we waited for its lock.
      if not exists(select 1 from mediasis.daily_preparation_reset_config where business_id = v_business and enabled) then continue; end if;
      select timezone into v_timezone from mediasis.business_market_settings where business_id = v_business;
      if v_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
        raise exception 'Missing or invalid business_market_settings.timezone; correct the business market settings';
      end if;
      v_today := (p_now at time zone v_timezone)::date;
      -- Defensive initialization for legacy/imported locations without state.
      insert into mediasis.daily_preparation_reset_location_state(business_location_id, last_processed_local_date)
      select id, v_today from mediasis.daily_preparation_reset_active_locations(v_business) id on conflict do nothing;
      select coalesce(array_agg(s.business_location_id order by s.business_location_id), '{}'::uuid[]) into v_due
      from mediasis.daily_preparation_reset_location_state s
      where s.business_location_id in (select mediasis.daily_preparation_reset_active_locations(v_business))
        and s.last_processed_local_date < v_today;
      if cardinality(v_due) = 0 then continue; end if;

      insert into mediasis.delivery_method_business_pickup_offset_location(
        business_delivery_method_id, business_location_id, pickup_ready_offset
      )
      select m.uid, bl.business_location_id, pg_catalog.make_interval(mins => coalesce(rv.reset_minutes, 10))
      from mediasis.delivery_methods_business m
      join mediasis.business_location bl on bl.business_uid = m.business_id and bl.business_location_id = any(v_due)
      left join mediasis.daily_preparation_reset_method_values rv on rv.business_delivery_method_id = m.uid
      where m.business_id = v_business and (m.scope = 'all' or exists (
        select 1 from mediasis.delivery_methods_business_location ml
        where ml.delivery_methods_business_id = m.uid and ml.business_location_id = bl.business_location_id
      ))
      order by m.uid, bl.business_location_id
      on conflict(business_delivery_method_id, business_location_id) do update
        set pickup_ready_offset = excluded.pickup_ready_offset;
      get diagnostics v_rows = row_count;
      update mediasis.daily_preparation_reset_location_state set last_processed_local_date = v_today, updated_at = p_now
        where business_location_id = any(v_due);
      insert into mediasis.daily_preparation_reset_runs(business_id, local_date, timezone, status, location_count, affected_row_count, updated_at)
      values(v_business, v_today, v_timezone, 'completed', cardinality(v_due), v_rows, p_now)
      on conflict(business_id, local_date, status) do update set
        location_count = daily_preparation_reset_runs.location_count + excluded.location_count,
        affected_row_count = daily_preparation_reset_runs.affected_row_count + excluded.affected_row_count,
        attempts = daily_preparation_reset_runs.attempts + 1, updated_at = excluded.updated_at;
      v_total_rows := v_total_rows + v_rows;
      v_total_locations := v_total_locations + cardinality(v_due);
    exception when others then
      -- This subtransaction rolls back BOTH offsets and state for this business.
      -- Keep the error outside the rolled-back work and continue other businesses.
      insert into mediasis.daily_preparation_reset_runs(business_id, local_date, timezone, status, error_message, updated_at)
      values(v_business, coalesce(v_today, (p_now at time zone 'UTC')::date), v_timezone, 'failed', sqlerrm, p_now)
      on conflict(business_id, local_date, status) do update set
        error_message = excluded.error_message, timezone = excluded.timezone,
        attempts = daily_preparation_reset_runs.attempts + 1, updated_at = excluded.updated_at;
      v_failures := v_failures + 1;
    end;
  end loop;
  return jsonb_build_object('success', v_failures = 0, 'status', case when v_failures = 0 then 'completed' else 'completed_with_errors' end,
    'affected_row_count', v_total_rows, 'location_count', v_total_locations, 'failed_business_count', v_failures);
end;
$$;

alter table mediasis.daily_preparation_reset_config enable row level security;
alter table mediasis.daily_preparation_reset_method_values enable row level security;
alter table mediasis.daily_preparation_reset_location_state enable row level security;
alter table mediasis.daily_preparation_reset_runs enable row level security;
revoke all on table mediasis.daily_preparation_reset_config, mediasis.daily_preparation_reset_method_values,
  mediasis.daily_preparation_reset_location_state, mediasis.daily_preparation_reset_runs from public, anon, authenticated, service_role;
grant select on table mediasis.daily_preparation_reset_config, mediasis.daily_preparation_reset_method_values,
  mediasis.daily_preparation_reset_location_state, mediasis.daily_preparation_reset_runs to service_role;
revoke all on function mediasis.daily_preparation_reset_active_locations(uuid) from public, anon, authenticated, service_role;
revoke all on function mediasis.initialize_daily_preparation_reset_location() from public, anon, authenticated, service_role;
revoke all on function mediasis.get_dashboard_daily_preparation_reset_settings(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.save_dashboard_daily_preparation_reset_settings(uuid,uuid,boolean,boolean,uuid[],jsonb) from public, anon, authenticated;
revoke all on function mediasis.run_daily_preparation_reset(timestamptz) from public, anon, authenticated;
grant execute on function mediasis.get_dashboard_daily_preparation_reset_settings(uuid,uuid),
  mediasis.save_dashboard_daily_preparation_reset_settings(uuid,uuid,boolean,boolean,uuid[],jsonb),
  mediasis.run_daily_preparation_reset(timestamptz) to service_role;

select cron.schedule('daily-preparation-reset-every-minute', '* * * * *', 'select mediasis.run_daily_preparation_reset();');
notify pgrst, 'reload schema';
commit;
