-- Migration: 038
-- Authorized overloads for the existing analytics RPCs.
-- Existing signatures remain untouched for legacy/mobile compatibility.

begin;

create or replace function mediasis.get_business_home_dashboard(
  p_start_utc_iso timestamptz,
  p_end_utc_iso timestamptz,
  p_start_utc_day date,
  p_end_utc_day date,
  p_location_id uuid,
  p_include_all_locations boolean,
  p_bucket text,
  p_requested_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original_subject text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
  v_membership_all_locations boolean := false;
begin
  if not mediasis.has_business_permission(p_requested_business_id, 'analytics.read') then
    return jsonb_build_object('success', false, 'message', 'No tenés permiso para ver estas analíticas.');
  end if;

  if mediasis.current_legacy_business_id() is null then
    if mediasis.is_current_mediasis_staff() then
      v_membership_all_locations := true;
    else
      select bm.all_locations into v_membership_all_locations
      from mediasis.business_memberships bm
      where bm.business_id = p_requested_business_id
        and bm.app_user_id = mediasis.current_business_app_user_id()
        and bm.status = 'active'
        and bm.revoked_at is null;
    end if;
    if not coalesce(v_membership_all_locations, false)
      and p_location_id is null
      and not coalesce(p_include_all_locations, false)
    then
      return jsonb_build_object('success', false, 'message', 'Seleccioná una ubicación permitida.');
    end if;
  end if;

  if coalesce(p_include_all_locations, false) then
    if mediasis.current_legacy_business_id() = p_requested_business_id
      or mediasis.is_current_mediasis_staff()
    then
      v_membership_all_locations := true;
    else
      select bm.all_locations into v_membership_all_locations
      from mediasis.business_memberships bm
      where bm.business_id = p_requested_business_id
        and bm.app_user_id = mediasis.current_business_app_user_id()
        and bm.status = 'active'
        and bm.revoked_at is null;
    end if;

    if not coalesce(v_membership_all_locations, false) then
      return jsonb_build_object('success', false, 'message', 'No tenés acceso a todas las ubicaciones.');
    end if;
  elsif p_location_id is not null
    and not mediasis.has_location_permission(p_location_id, 'analytics.read')
  then
    return jsonb_build_object('success', false, 'message', 'No tenés acceso a esta ubicación.');
  end if;

  -- The authoritative legacy implementation derives its tenant through
  -- auth.uid(). After the checks above, temporarily supplying the validated
  -- business UUID lets this overload reuse that implementation without
  -- duplicating hundreds of lines of financial aggregation logic.
  perform set_config('request.jwt.claim.sub', p_requested_business_id::text, true);
  begin
    v_result := mediasis.get_business_home_dashboard(
      p_start_utc_iso,
      p_end_utc_iso,
      p_start_utc_day,
      p_end_utc_day,
      p_location_id,
      p_include_all_locations,
      p_bucket
    );
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_original_subject, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(v_original_subject, ''), true);
  return v_result;
end;
$$;

create or replace function mediasis.get_business_summary_dashboard(
  p_start_utc_iso timestamptz,
  p_end_utc_iso timestamptz,
  p_start_utc_day date,
  p_end_utc_day date,
  p_location_id uuid,
  p_include_all_locations boolean,
  p_requested_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original_subject text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
  v_membership_all_locations boolean := false;
begin
  if not mediasis.has_business_permission(p_requested_business_id, 'analytics.read') then
    return jsonb_build_object('success', false, 'message', 'No tenés permiso para ver estas analíticas.');
  end if;

  if mediasis.current_legacy_business_id() is null then
    if mediasis.is_current_mediasis_staff() then
      v_membership_all_locations := true;
    else
      select bm.all_locations into v_membership_all_locations
      from mediasis.business_memberships bm
      where bm.business_id = p_requested_business_id
        and bm.app_user_id = mediasis.current_business_app_user_id()
        and bm.status = 'active'
        and bm.revoked_at is null;
    end if;
    if not coalesce(v_membership_all_locations, false)
      and p_location_id is null
      and not coalesce(p_include_all_locations, false)
    then
      return jsonb_build_object('success', false, 'message', 'Seleccioná una ubicación permitida.');
    end if;
  end if;

  if coalesce(p_include_all_locations, false) then
    if mediasis.current_legacy_business_id() = p_requested_business_id
      or mediasis.is_current_mediasis_staff()
    then
      v_membership_all_locations := true;
    else
      select bm.all_locations into v_membership_all_locations
      from mediasis.business_memberships bm
      where bm.business_id = p_requested_business_id
        and bm.app_user_id = mediasis.current_business_app_user_id()
        and bm.status = 'active'
        and bm.revoked_at is null;
    end if;

    if not coalesce(v_membership_all_locations, false) then
      return jsonb_build_object('success', false, 'message', 'No tenés acceso a todas las ubicaciones.');
    end if;
  elsif p_location_id is not null
    and not mediasis.has_location_permission(p_location_id, 'analytics.read')
  then
    return jsonb_build_object('success', false, 'message', 'No tenés acceso a esta ubicación.');
  end if;

  perform set_config('request.jwt.claim.sub', p_requested_business_id::text, true);
  begin
    v_result := mediasis.get_business_summary_dashboard(
      p_start_utc_iso,
      p_end_utc_iso,
      p_start_utc_day,
      p_end_utc_day,
      p_location_id,
      p_include_all_locations
    );
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_original_subject, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(v_original_subject, ''), true);
  return v_result;
end;
$$;

revoke all on function mediasis.get_business_home_dashboard(timestamptz, timestamptz, date, date, uuid, boolean, text, uuid) from public, anon;
revoke all on function mediasis.get_business_summary_dashboard(timestamptz, timestamptz, date, date, uuid, boolean, uuid) from public, anon;
grant execute on function mediasis.get_business_home_dashboard(timestamptz, timestamptz, date, date, uuid, boolean, text, uuid) to authenticated, service_role;
grant execute on function mediasis.get_business_summary_dashboard(timestamptz, timestamptz, date, date, uuid, boolean, uuid) to authenticated, service_role;

commit;
