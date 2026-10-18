-- Migration: 008
-- Consumer ownership and progressive account claims.
-- Additive draft: review and apply before enabling the account-creation CTA.

begin;

alter table mediasis.client
  add column if not exists app_user_id uuid,
  add column if not exists deleted_at timestamptz;
alter table mediasis.cart
  add column if not exists app_user_id uuid,
  add column if not exists deleted_at timestamptz;
alter table mediasis.orders
  add column if not exists app_user_id uuid,
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_app_user_fk' and conrelid = 'mediasis.client'::regclass
  ) then
    alter table mediasis.client
      add constraint client_app_user_fk foreign key (app_user_id)
      references mediasis.app_users(app_user_id)
      on update cascade on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'cart_app_user_fk' and conrelid = 'mediasis.cart'::regclass
  ) then
    alter table mediasis.cart
      add constraint cart_app_user_fk foreign key (app_user_id)
      references mediasis.app_users(app_user_id)
      on update cascade on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_app_user_fk' and conrelid = 'mediasis.orders'::regclass
  ) then
    alter table mediasis.orders
      add constraint orders_app_user_fk foreign key (app_user_id)
      references mediasis.app_users(app_user_id)
      on update cascade on delete restrict;
  end if;
end
$$;

create unique index if not exists client_active_app_user_unique
  on mediasis.client(app_user_id)
  where app_user_id is not null and deleted_at is null;
create index if not exists cart_app_user_idx
  on mediasis.cart(app_user_id)
  where app_user_id is not null;
create index if not exists orders_app_user_created_idx
  on mediasis.orders(app_user_id, created_at desc)
  where app_user_id is not null;

create table if not exists mediasis.consumer_account_claims (
  consumer_account_claim_id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  order_id uuid not null
    references mediasis.orders(order_id)
    on update cascade on delete restrict,
  verified_phone text not null,
  business_domain text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_app_user_id uuid
    references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  constraint consumer_account_claim_token_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint consumer_account_claim_phone_not_blank
    check (btrim(verified_phone) <> ''),
  constraint consumer_account_claim_domain_not_blank
    check (btrim(business_domain) <> ''),
  constraint consumer_account_claim_consumption_valid
    check (
      (consumed_at is null and consumed_by_app_user_id is null)
      or
      (consumed_at is not null and consumed_by_app_user_id is not null)
    )
);

create index if not exists consumer_account_claim_expiry_idx
  on mediasis.consumer_account_claims(expires_at)
  where consumed_at is null;
create index if not exists consumer_account_claim_open_order_idx
  on mediasis.consumer_account_claims(order_id, expires_at desc)
  where consumed_at is null;

alter table mediasis.consumer_account_claims enable row level security;
revoke all on table mediasis.consumer_account_claims from public, anon, authenticated;

create or replace function mediasis.prevent_consumer_owner_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.app_user_id is not null
     and new.app_user_id is distinct from old.app_user_id then
    raise exception 'Consumer ownership cannot be reassigned';
  end if;
  return new;
end;
$$;

create or replace function mediasis.prevent_owned_commerce_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.app_user_id is not null then
    raise exception 'Consumer-owned % records must be logically deleted', tg_table_name;
  end if;
  return old;
end;
$$;

drop trigger if exists orders_prevent_consumer_owner_reassignment on mediasis.orders;
create trigger orders_prevent_consumer_owner_reassignment
before update of app_user_id on mediasis.orders
for each row execute function mediasis.prevent_consumer_owner_reassignment();

drop trigger if exists client_prevent_consumer_owner_reassignment on mediasis.client;
create trigger client_prevent_consumer_owner_reassignment
before update of app_user_id on mediasis.client
for each row execute function mediasis.prevent_consumer_owner_reassignment();

drop trigger if exists orders_consumer_logical_delete_only on mediasis.orders;
create trigger orders_consumer_logical_delete_only
before delete on mediasis.orders
for each row execute function mediasis.prevent_owned_commerce_delete();

drop trigger if exists cart_consumer_logical_delete_only on mediasis.cart;
create trigger cart_consumer_logical_delete_only
before delete on mediasis.cart
for each row execute function mediasis.prevent_owned_commerce_delete();

drop trigger if exists client_consumer_logical_delete_only on mediasis.client;
create trigger client_consumer_logical_delete_only
before delete on mediasis.client
for each row execute function mediasis.prevent_owned_commerce_delete();

create or replace function mediasis.prevent_consumer_claim_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Consumer account claims are retained as authorization evidence';
end;
$$;

drop trigger if exists consumer_account_claim_logical_delete_only
  on mediasis.consumer_account_claims;
create trigger consumer_account_claim_logical_delete_only
before delete on mediasis.consumer_account_claims
for each row execute function mediasis.prevent_consumer_claim_delete();

create or replace function mediasis.create_consumer_account_claim(
  p_order_id uuid,
  p_domain text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_phone text;
  normalized_domain text := lower(btrim(p_domain));
  claim_expiry timestamptz := now() + interval '15 minutes';
begin
  if p_order_id is null
     or normalized_domain = ''
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('success', false, 'message', 'Invalid claim request.');
  end if;

  select o.client
    into claim_phone
  from mediasis.orders o
  join mediasis.business_location bl
    on bl.business_location_id = o.business_location_id
  join mediasis.businesses b
    on b.uid = bl.business_uid
  join mediasis.business_domain bd
    on bd.business_uid = b.uid
   and bd.type = 'order_app'
  where o.order_id = p_order_id
    and o.app_user_id is null
    and lower(bd.domain) = normalized_domain
    and coalesce(b.active, false)
  for update of o;

  if claim_phone is null or btrim(claim_phone) = '' then
    return jsonb_build_object('success', false, 'message', 'Order is not claimable.');
  end if;

  update mediasis.consumer_account_claims
     set expires_at = now()
   where order_id = p_order_id
     and consumed_at is null;

  insert into mediasis.consumer_account_claims (
    token_hash, order_id, verified_phone, business_domain, expires_at
  ) values (
    p_token_hash, p_order_id, claim_phone, normalized_domain, claim_expiry
  );

  return jsonb_build_object('success', true, 'expires_at', claim_expiry);
end;
$$;

create or replace function mediasis.consume_consumer_account_claim(
  p_token_hash text,
  p_app_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_row mediasis.consumer_account_claims%rowtype;
  order_phone text;
  existing_owner uuid;
  existing_client_owner uuid;
begin
  select *
    into claim_row
  from mediasis.consumer_account_claims
  where token_hash = p_token_hash
  for update;

  if claim_row.consumer_account_claim_id is null
     or claim_row.consumed_at is not null
     or claim_row.expires_at <= now() then
    return jsonb_build_object('success', false, 'message', 'Claim expired or already consumed.');
  end if;

  if not exists (
    select 1 from mediasis.app_users au
    where au.app_user_id = p_app_user_id and au.status = 'active'
  ) then
    return jsonb_build_object('success', false, 'message', 'Consumer is not active.');
  end if;

  select o.client, o.app_user_id
    into order_phone, existing_owner
  from mediasis.orders o
  where o.order_id = claim_row.order_id
  for update;

  if order_phone is distinct from claim_row.verified_phone
     or (existing_owner is not null and existing_owner <> p_app_user_id) then
    return jsonb_build_object('success', false, 'message', 'Order ownership changed.');
  end if;

  select c.app_user_id
    into existing_client_owner
  from mediasis.client c
  where c.phone_number = claim_row.verified_phone
  for update;

  if existing_client_owner is not null
     and existing_client_owner <> p_app_user_id then
    return jsonb_build_object('success', false, 'message', 'Phone is linked to another consumer.');
  end if;

  update mediasis.client
     set app_user_id = p_app_user_id
   where phone_number = claim_row.verified_phone
     and (app_user_id is null or app_user_id = p_app_user_id);

  update mediasis.orders
     set app_user_id = p_app_user_id
   where order_id = claim_row.order_id
     and app_user_id is null;

  update mediasis.consumer_account_claims
     set consumed_at = now(),
         consumed_by_app_user_id = p_app_user_id
   where consumer_account_claim_id = claim_row.consumer_account_claim_id;

  insert into mediasis.authorization_audit_log (
    actor_app_user_id, subject_app_user_id, action, target_type,
    target_id, source, after_value
  ) values (
    p_app_user_id, p_app_user_id, 'consumer.order_claimed', 'order',
    claim_row.order_id::text, 'application',
    jsonb_build_object('phone', claim_row.verified_phone)
  );

  return jsonb_build_object('success', true, 'order_id', claim_row.order_id);
end;
$$;

revoke all on function mediasis.create_consumer_account_claim(uuid, text, text) from public;
revoke all on function mediasis.consume_consumer_account_claim(text, uuid) from public;
grant execute on function mediasis.create_consumer_account_claim(uuid, text, text) to service_role;
grant execute on function mediasis.consume_consumer_account_claim(text, uuid) to service_role;

commit;
