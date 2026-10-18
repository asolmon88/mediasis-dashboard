-- Migration: 022
-- ONVO customer mapping for the Mediasis consumer wallet.
-- Draft only. Apply only after platform-customer/onBehalfOf compatibility is verified in ONVO test mode.

begin;

alter table mediasis.consumer_profiles
  add column if not exists onvo_customer_id text;

comment on column mediasis.consumer_profiles.onvo_customer_id is
  'Server-only ONVO platform customer identifier. Card credentials and CVV remain exclusively in ONVO.';

alter table mediasis.consumer_profiles
  drop constraint if exists consumer_profiles_onvo_customer_id_not_blank;

alter table mediasis.consumer_profiles
  add constraint consumer_profiles_onvo_customer_id_not_blank
  check (onvo_customer_id is null or btrim(onvo_customer_id) <> '');

create unique index if not exists consumer_profiles_active_onvo_customer_unique
  on mediasis.consumer_profiles (onvo_customer_id)
  where onvo_customer_id is not null and deleted_at is null;

commit;

-- Verification (read-only):
-- select app_user_id, onvo_customer_id from mediasis.consumer_profiles where onvo_customer_id is not null;
-- select onvo_customer_id, count(*) from mediasis.consumer_profiles
-- where onvo_customer_id is not null and deleted_at is null group by onvo_customer_id having count(*) > 1;
