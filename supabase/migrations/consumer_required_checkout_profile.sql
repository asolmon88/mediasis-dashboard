-- Migration: 015
-- Require an editable consumer display name and an international phone number
-- before an authenticated consumer can place orders.
--
-- Reviewable draft only. Apply after the matching order-app code is deployed.
-- Depends on 001_clerk_identity_foundation.sql and
-- 009_consumer_profile_and_order_api.sql.

begin;

alter table mediasis.consumer_profiles
  add column if not exists profile_completed_at timestamptz;

comment on column mediasis.consumer_profiles.profile_completed_at is
  'Set when the consumer has an email identity, editable display name, and valid international phone number required for checkout.';

-- Preserve completion for any existing consumer that already has all required
-- checkout contact data. Phone ownership is not asserted by this timestamp.
update mediasis.consumer_profiles cp
   set profile_completed_at = coalesce(cp.profile_completed_at, now()),
       updated_at = now()
  from mediasis.app_users au
 where au.app_user_id = cp.app_user_id
   and au.status = 'active'
   and au.deleted_at is null
   and nullif(btrim(au.display_name), '') is not null
   and nullif(btrim(au.primary_email), '') is not null
   and cp.phone_number ~ '^\+[1-9][0-9]{6,14}$'
   and cp.deleted_at is null
   and cp.profile_completed_at is null;

drop function if exists mediasis.update_my_consumer_profile(text);

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
  current_email text;
  completed_at timestamptz := now();
begin
  if current_user_id is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated.');
  end if;

  if normalized_name is null or length(normalized_name) > 120 then
    return jsonb_build_object('success', false, 'message', 'Invalid display name.');
  end if;

  -- The shared checkout PhoneInput submits E.164 values. Accept every country,
  -- while rejecting local/unparseable numbers and impossible E.164 lengths.
  if normalized_phone is null
     or normalized_phone !~ '^\+[1-9][0-9]{6,14}$' then
    return jsonb_build_object('success', false, 'message', 'Invalid phone number.');
  end if;

  update mediasis.app_users
     set display_name = normalized_name,
         updated_at = now()
   where app_user_id = current_user_id
     and status = 'active'
     and deleted_at is null
  returning primary_email into current_email;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Consumer account is not active.');
  end if;

  if nullif(btrim(current_email), '') is null then
    return jsonb_build_object('success', false, 'message', 'Consumer email is required.');
  end if;

  insert into mediasis.consumer_profiles (
    app_user_id,
    phone_number,
    profile_completed_at,
    deleted_at,
    updated_at
  ) values (
    current_user_id,
    normalized_phone,
    completed_at,
    null,
    now()
  )
  on conflict (app_user_id) do update
     set phone_number = excluded.phone_number,
         profile_completed_at = excluded.profile_completed_at,
         deleted_at = null,
         updated_at = now();

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'display_name', normalized_name,
      'phone_number', normalized_phone,
      'profile_completed_at', completed_at
    )
  );
end;
$$;

revoke all on function mediasis.update_my_consumer_profile(text, text) from public;
revoke all on function mediasis.update_my_consumer_profile(text, text) from anon;
grant execute on function mediasis.update_my_consumer_profile(text, text) to authenticated;

commit;
