-- Migration: 030
-- Make Clerk user deletion release account-scoped identities and access
-- atomically while preserving commerce and financial history.
-- Draft only: apply before deploying the webhook change that calls this RPC.

begin;

create or replace function mediasis.handle_clerk_user_deleted(
  p_clerk_user_id text,
  p_deleted_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clerk_user_id text := nullif(btrim(p_clerk_user_id), '');
  v_deleted_at timestamptz := coalesce(p_deleted_at, now());
  v_app_user_id uuid;
begin
  if v_clerk_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'invalid_clerk_user_id',
      'message', 'Clerk user ID is required.'
    );
  end if;

  -- Keep a tombstone even if a delete event arrives before user.created.
  -- On conflict, preserve the first deletion timestamp so webhook replays are
  -- idempotent and do not rewrite the historical deletion time.
  insert into mediasis.app_users (
    clerk_user_id,
    status,
    deleted_at,
    updated_at
  ) values (
    v_clerk_user_id,
    'deleted',
    v_deleted_at,
    v_deleted_at
  )
  on conflict (clerk_user_id) do update set
    status = 'deleted',
    deleted_at = coalesce(mediasis.app_users.deleted_at, excluded.deleted_at),
    updated_at = greatest(mediasis.app_users.updated_at, excluded.updated_at)
  returning app_user_id, deleted_at
  into v_app_user_id, v_deleted_at;

  -- Releasing the active profile releases the partial unique constraints for
  -- phone number and ONVO customer ID. Historical values remain available for
  -- retained orders, cashback, auditing, and an explicitly reviewed purge.
  update mediasis.consumer_profiles
  set deleted_at = coalesce(deleted_at, v_deleted_at),
      updated_at = greatest(updated_at, v_deleted_at)
  where app_user_id = v_app_user_id
    and deleted_at is null;

  update mediasis.consumer_saved_locations
  set is_current = false,
      deleted_at = coalesce(deleted_at, v_deleted_at),
      updated_at = greatest(updated_at, v_deleted_at)
  where app_user_id = v_app_user_id
    and deleted_at is null;

  update mediasis.consumer_phone_verification_challenges
  set invalidated_at = coalesce(invalidated_at, v_deleted_at)
  where app_user_id = v_app_user_id
    and consumed_at is null
    and invalidated_at is null;

  update mediasis.business_memberships
  set status = 'revoked',
      revoked_at = coalesce(revoked_at, v_deleted_at),
      updated_at = greatest(updated_at, v_deleted_at)
  where app_user_id = v_app_user_id
    and status <> 'revoked';

  update mediasis.staff_memberships
  set status = 'revoked',
      revoked_at = coalesce(revoked_at, v_deleted_at),
      updated_at = greatest(updated_at, v_deleted_at)
  where app_user_id = v_app_user_id
    and status <> 'revoked';

  return jsonb_build_object(
    'success', true,
    'app_user_id', v_app_user_id,
    'deleted_at', v_deleted_at
  );
end;
$$;

revoke all on function mediasis.handle_clerk_user_deleted(text, timestamptz)
  from public, anon, authenticated;
grant execute on function mediasis.handle_clerk_user_deleted(text, timestamptz)
  to service_role;

comment on function mediasis.handle_clerk_user_deleted(text, timestamptz) is
  'Atomically tombstones a deleted Clerk identity and logically revokes its account-scoped profile, locations, challenges, and memberships.';

-- Repair deletion events processed by the previous webhook implementation.
-- This is data-driven rather than tied to one email, phone, or Clerk subject.
update mediasis.consumer_profiles cp
set deleted_at = au.deleted_at,
    updated_at = greatest(cp.updated_at, au.deleted_at)
from mediasis.app_users au
where au.app_user_id = cp.app_user_id
  and au.status = 'deleted'
  and au.deleted_at is not null
  and cp.deleted_at is null;

update mediasis.consumer_saved_locations l
set is_current = false,
    deleted_at = au.deleted_at,
    updated_at = greatest(l.updated_at, au.deleted_at)
from mediasis.app_users au
where au.app_user_id = l.app_user_id
  and au.status = 'deleted'
  and au.deleted_at is not null
  and l.deleted_at is null;

update mediasis.consumer_phone_verification_challenges c
set invalidated_at = au.deleted_at
from mediasis.app_users au
where au.app_user_id = c.app_user_id
  and au.status = 'deleted'
  and au.deleted_at is not null
  and c.consumed_at is null
  and c.invalidated_at is null;

update mediasis.business_memberships m
set status = 'revoked',
    revoked_at = coalesce(m.revoked_at, au.deleted_at),
    updated_at = greatest(m.updated_at, au.deleted_at)
from mediasis.app_users au
where au.app_user_id = m.app_user_id
  and au.status = 'deleted'
  and au.deleted_at is not null
  and m.status <> 'revoked';

update mediasis.staff_memberships m
set status = 'revoked',
    revoked_at = coalesce(m.revoked_at, au.deleted_at),
    updated_at = greatest(m.updated_at, au.deleted_at)
from mediasis.app_users au
where au.app_user_id = m.app_user_id
  and au.status = 'deleted'
  and au.deleted_at is not null
  and m.status <> 'revoked';

commit;

-- Verification (read-only; run after applying the migration):
--
-- select au.app_user_id, au.clerk_user_id, cp.phone_number
-- from mediasis.app_users au
-- join mediasis.consumer_profiles cp on cp.app_user_id = au.app_user_id
-- where (au.status = 'deleted' or au.deleted_at is not null)
--   and cp.deleted_at is null;
--
-- select app_user_id, phone_number, deleted_at
-- from mediasis.consumer_profiles
-- where phone_number = '+50683117124'
-- order by created_at desc;
