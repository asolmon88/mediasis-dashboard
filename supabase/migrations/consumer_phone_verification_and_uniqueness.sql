-- Migration: 016
-- Corrective migration after 015: profile completion now requires an
-- account-bound Mediasis OTP, and one active phone/email belongs to one account.

begin;

alter table mediasis.consumer_profiles
  add column if not exists phone_verified_at timestamptz,
  add column if not exists phone_verification_source text;

-- 015 did not verify phone ownership. Require every previously completed
-- profile to complete the new OTP before authenticated checkout.
update mediasis.consumer_profiles
set profile_completed_at = null,
    phone_verified_at = null,
    phone_verification_source = null,
    updated_at = now()
where profile_completed_at is not null
  and phone_verified_at is null;

do $$
begin
  if exists (
    select 1 from mediasis.consumer_profiles
    where deleted_at is null and phone_number is not null
    group by phone_number having count(*) > 1
  ) then
    raise exception 'Cannot enforce one-account-per-phone: duplicate active phone numbers exist.';
  end if;
end;
$$;

create unique index if not exists consumer_profiles_active_phone_unique
  on mediasis.consumer_profiles (phone_number)
  where phone_number is not null and deleted_at is null;

create table if not exists mediasis.consumer_phone_verification_challenges (
  challenge_id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  phone_number text not null,
  code_hash text not null,
  wrong_attempts integer not null default 0 check (wrong_attempts between 0 and 3),
  ip_address inet,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint consumer_phone_challenge_phone_e164
    check (phone_number ~ '^\+[1-9][0-9]{6,14}$')
);

create index if not exists consumer_phone_challenges_user_created_idx
  on mediasis.consumer_phone_verification_challenges (app_user_id, created_at desc);
create index if not exists consumer_phone_challenges_phone_created_idx
  on mediasis.consumer_phone_verification_challenges (phone_number, created_at desc);

alter table mediasis.consumer_phone_verification_challenges enable row level security;
revoke all on table mediasis.consumer_phone_verification_challenges from public, anon, authenticated;
grant select, insert, update on table mediasis.consumer_phone_verification_challenges to service_role;

create or replace function mediasis.update_my_consumer_profile(
  p_display_name text,
  p_phone_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := mediasis.current_app_user_id();
  normalized_name text := nullif(btrim(p_display_name), '');
  normalized_phone text := nullif(btrim(p_phone_number), '');
  existing_phone text;
  verified_at timestamptz;
begin
  if current_user_id is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated.');
  end if;
  if normalized_name is null or length(normalized_name) > 120 then
    return jsonb_build_object('success', false, 'message', 'Invalid display name.');
  end if;
  if normalized_phone is null or normalized_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return jsonb_build_object('success', false, 'message', 'Invalid phone number.');
  end if;

  select phone_number, phone_verified_at into existing_phone, verified_at
  from mediasis.consumer_profiles
  where app_user_id = current_user_id and deleted_at is null;

  if verified_at is null or existing_phone is distinct from normalized_phone then
    return jsonb_build_object(
      'success', false,
      'code', 'phone_verification_required',
      'message', 'Phone verification required.'
    );
  end if;

  update mediasis.app_users set display_name = normalized_name, updated_at = now()
  where app_user_id = current_user_id and status = 'active' and deleted_at is null;

  return jsonb_build_object('success', found);
end;
$$;

create or replace function mediasis.complete_consumer_phone_verification(
  p_app_user_id uuid,
  p_challenge_id uuid,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := nullif(btrim(p_display_name), '');
  verified_phone text;
begin
  if normalized_name is null or length(normalized_name) > 120 then
    return jsonb_build_object('success', false, 'message', 'Invalid display name.');
  end if;

  select phone_number into verified_phone
  from mediasis.consumer_phone_verification_challenges
  where challenge_id = p_challenge_id
    and app_user_id = p_app_user_id
    and expires_at > now()
    and consumed_at is null
    and invalidated_at is null
    and wrong_attempts < 3
  for update;

  if verified_phone is null then
    return jsonb_build_object('success', false, 'message', 'Invalid verification challenge.');
  end if;

  update mediasis.app_users
  set display_name = normalized_name, updated_at = now()
  where app_user_id = p_app_user_id
    and status = 'active' and deleted_at is null
    and nullif(btrim(primary_email), '') is not null;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Active account email is required.');
  end if;

  insert into mediasis.consumer_profiles (
    app_user_id, phone_number, phone_verified_at,
    phone_verification_source, profile_completed_at, deleted_at, updated_at
  ) values (
    p_app_user_id, verified_phone, now(), 'mediasis_sms_otp', now(), null, now()
  )
  on conflict (app_user_id) do update set
    phone_number = excluded.phone_number,
    phone_verified_at = excluded.phone_verified_at,
    phone_verification_source = excluded.phone_verification_source,
    profile_completed_at = excluded.profile_completed_at,
    deleted_at = null,
    updated_at = now();

  update mediasis.consumer_phone_verification_challenges
  set consumed_at = now()
  where challenge_id = p_challenge_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function mediasis.update_my_consumer_profile(text, text) from public, anon;
grant execute on function mediasis.update_my_consumer_profile(text, text) to authenticated;
revoke all on function mediasis.complete_consumer_phone_verification(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function mediasis.complete_consumer_phone_verification(uuid, uuid, text)
  to service_role;

-- app_users_primary_email_unique from 001 already enforces one active email
-- per account. Fail explicitly if that foundation invariant is missing.
do $$
begin
  if to_regclass('mediasis.app_users_primary_email_unique') is null then
    raise exception 'Required active-email uniqueness index is missing.';
  end if;
end;
$$;

commit;
