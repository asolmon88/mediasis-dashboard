-- Migration: 024
-- Pharmacy-funded cashback: configuration, per-order snapshots, immutable
-- ledger, earning release, redemption reservation, expiry, and refunds.
--
-- Draft only. Apply explicitly after migration 023 and deploy the order app
-- that calls create_checkout_order_with_cashback at the same time.

begin;

create table if not exists mediasis.business_cashback_settings (
  business_uid uuid primary key references mediasis.businesses(uid)
    on update cascade on delete restrict,
  enabled boolean not null default false,
  percentage numeric(5,2) not null default 0,
  updated_by_business_uid uuid references mediasis.businesses(uid)
    on update cascade on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_cashback_percentage_valid
    check (percentage between 0 and 100)
);

create table if not exists mediasis.order_cashback (
  order_id uuid primary key references mediasis.orders(order_id)
    on update cascade on delete restrict,
  app_user_id uuid references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  business_uid uuid not null references mediasis.businesses(uid)
    on update cascade on delete restrict,
  percentage numeric(5,2) not null default 0,
  eligible_products_minor bigint not null default 0,
  earned_minor bigint not null default 0,
  redeemed_minor bigint not null default 0,
  earning_status text not null default 'pending',
  redemption_status text not null default 'none',
  available_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_cashback_percentage_valid check (percentage between 0 and 100),
  constraint order_cashback_amounts_valid check (
    eligible_products_minor >= 0 and earned_minor >= 0 and redeemed_minor >= 0
  ),
  constraint order_cashback_earning_status_valid check (
    earning_status in ('pending', 'available', 'reversed', 'expired')
  ),
  constraint order_cashback_redemption_status_valid check (
    redemption_status in ('none', 'reserved', 'captured', 'released', 'reversed')
  ),
  constraint order_cashback_redemption_consumer_required check (
    redeemed_minor = 0 or app_user_id is not null
  )
);

create table if not exists mediasis.cashback_events (
  cashback_event_id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  business_uid uuid not null references mediasis.businesses(uid)
    on update cascade on delete restrict,
  order_id uuid not null references mediasis.orders(order_id)
    on update cascade on delete restrict,
  source_earning_order_id uuid references mediasis.orders(order_id)
    on update cascade on delete restrict,
  event_type text not null,
  amount_minor bigint not null,
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint cashback_events_type_valid check (event_type in (
    'earning_released', 'redemption_reserved', 'reservation_released',
    'redemption_captured', 'earning_reversed', 'redeemed_cashback_restored',
    'expiration', 'refund_adjustment'
  )),
  constraint cashback_events_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint cashback_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint cashback_events_amount_direction check (
    (event_type = 'earning_released' and amount_minor > 0) or
    (event_type = 'redemption_reserved' and amount_minor < 0) or
    (event_type = 'reservation_released' and amount_minor > 0) or
    (event_type = 'redemption_captured' and amount_minor = 0) or
    (event_type = 'earning_reversed' and amount_minor < 0) or
    (event_type = 'redeemed_cashback_restored' and amount_minor > 0) or
    (event_type = 'expiration' and amount_minor < 0) or
    event_type = 'refund_adjustment'
  )
);

create index if not exists order_cashback_consumer_business_idx
  on mediasis.order_cashback(app_user_id, business_uid, created_at desc)
  where app_user_id is not null;
create index if not exists order_cashback_pending_idx
  on mediasis.order_cashback(earning_status, order_id)
  where earning_status = 'pending';
create index if not exists order_cashback_expiry_idx
  on mediasis.order_cashback(expires_at)
  where earning_status = 'available';
create index if not exists cashback_events_balance_idx
  on mediasis.cashback_events(app_user_id, business_uid, occurred_at, cashback_event_id);
create index if not exists cashback_events_lot_idx
  on mediasis.cashback_events(app_user_id, business_uid, source_earning_order_id, occurred_at)
  where source_earning_order_id is not null;
create index if not exists cashback_events_order_idx
  on mediasis.cashback_events(order_id, occurred_at, cashback_event_id);

alter table mediasis.business_cashback_settings enable row level security;
alter table mediasis.order_cashback enable row level security;
alter table mediasis.cashback_events enable row level security;

drop policy if exists business_cashback_settings_owner_read on mediasis.business_cashback_settings;
create policy business_cashback_settings_owner_read
  on mediasis.business_cashback_settings for select to authenticated
  using (business_uid = auth.uid());

drop policy if exists order_cashback_consumer_read_own on mediasis.order_cashback;
create policy order_cashback_consumer_read_own
  on mediasis.order_cashback for select to authenticated
  using (
    app_user_id = mediasis.current_app_user_id()
    and exists (
      select 1 from mediasis.app_users au
      where au.app_user_id = order_cashback.app_user_id
        and au.status = 'active' and au.deleted_at is null
    )
  );

drop policy if exists cashback_events_consumer_read_own on mediasis.cashback_events;
create policy cashback_events_consumer_read_own
  on mediasis.cashback_events for select to authenticated
  using (
    app_user_id = mediasis.current_app_user_id()
    and exists (
      select 1 from mediasis.app_users au
      where au.app_user_id = cashback_events.app_user_id
        and au.status = 'active' and au.deleted_at is null
    )
  );

-- Ledger rows are accounting evidence. Corrections are compensating events;
-- an existing event is never edited or deleted.
create or replace function mediasis.prevent_cashback_event_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Cashback events are append-only';
end;
$$;

drop trigger if exists cashback_events_append_only on mediasis.cashback_events;
create trigger cashback_events_append_only
before update or delete on mediasis.cashback_events
for each row execute function mediasis.prevent_cashback_event_mutation();

drop trigger if exists order_cashback_no_delete on mediasis.order_cashback;
create trigger order_cashback_no_delete
before delete on mediasis.order_cashback
for each row execute function mediasis.prevent_cashback_event_mutation();

drop trigger if exists business_cashback_settings_no_delete on mediasis.business_cashback_settings;
create trigger business_cashback_settings_no_delete
before delete on mediasis.business_cashback_settings
for each row execute function mediasis.prevent_cashback_event_mutation();

create or replace function mediasis.validate_order_cashback_integrity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_business uuid; v_owner uuid;
begin
  select bl.business_uid, o.app_user_id into v_business, v_owner
  from mediasis.orders o
  join mediasis.business_location bl on bl.business_location_id = o.business_location_id
  where o.order_id = new.order_id;
  if v_business is null or new.business_uid is distinct from v_business then
    raise exception 'Cashback business does not match order';
  end if;
  if new.app_user_id is distinct from v_owner then
    raise exception 'Cashback consumer does not match order owner';
  end if;
  if tg_op = 'UPDATE' and (
    new.order_id is distinct from old.order_id or
    new.business_uid is distinct from old.business_uid or
    (old.app_user_id is not null and new.app_user_id is distinct from old.app_user_id)
  ) then
    raise exception 'Cashback order identity is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists order_cashback_integrity on mediasis.order_cashback;
create trigger order_cashback_integrity
before insert or update of order_id, business_uid, app_user_id on mediasis.order_cashback
for each row execute function mediasis.validate_order_cashback_integrity();

create or replace function mediasis.validate_cashback_event_integrity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from mediasis.order_cashback oc
    where oc.order_id = new.order_id
      and oc.app_user_id = new.app_user_id
      and oc.business_uid = new.business_uid
  ) then
    raise exception 'Cashback event does not match affected order';
  end if;
  if new.source_earning_order_id is not null and not exists (
    select 1 from mediasis.order_cashback source
    where source.order_id = new.source_earning_order_id
      and source.app_user_id = new.app_user_id
      and source.business_uid = new.business_uid
  ) then
    raise exception 'Cashback source earning does not match consumer and business';
  end if;
  return new;
end;
$$;

drop trigger if exists cashback_events_integrity on mediasis.cashback_events;
create trigger cashback_events_integrity
before insert on mediasis.cashback_events
for each row execute function mediasis.validate_cashback_event_integrity();

create or replace function mediasis.get_business_cashback_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_business uuid := auth.uid(); v_row mediasis.business_cashback_settings%rowtype;
begin
  if v_business is null or not exists (
    select 1 from mediasis.businesses b where b.uid = v_business
  ) then
    return jsonb_build_object('success', false, 'message', 'Business not found.');
  end if;
  select * into v_row from mediasis.business_cashback_settings s
  where s.business_uid = v_business;
  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'enabled', coalesce(v_row.enabled, false),
      'percentage', coalesce(v_row.percentage, 0),
      'updated_at', v_row.updated_at
    )
  );
end;
$$;

create or replace function mediasis.update_business_cashback_settings(
  p_enabled boolean,
  p_percentage numeric
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_business uuid := auth.uid();
begin
  if v_business is null or not exists (
    select 1 from mediasis.businesses b
    where b.uid = v_business and coalesce(b.app_active, false)
  ) then
    return jsonb_build_object('success', false, 'message', 'Business not authorized.');
  end if;
  if p_percentage is null or p_percentage < 0 or p_percentage > 100
     or p_percentage <> round(p_percentage, 2) then
    return jsonb_build_object('success', false, 'message', 'Percentage must have at most two decimals and be between 0 and 100.');
  end if;
  insert into mediasis.business_cashback_settings (
    business_uid, enabled, percentage, updated_by_business_uid, created_at, updated_at
  ) values (v_business, p_enabled, p_percentage, v_business, now(), now())
  on conflict (business_uid) do update set
    enabled = excluded.enabled,
    percentage = excluded.percentage,
    updated_by_business_uid = v_business,
    updated_at = now();
  return jsonb_build_object('success', true);
end;
$$;

create or replace function mediasis.resolve_cashback_business(p_domain text)
returns uuid language sql stable security definer set search_path = '' as $$
  select bd.business_uid
  from mediasis.business_domain bd
  join mediasis.businesses b on b.uid = bd.business_uid
  where mediasis.normalize_consumer_auth_domain(bd.domain) =
        mediasis.normalize_consumer_auth_domain(p_domain)
    and bd.type = 'order_app'
    and coalesce(b.active, false)
  limit 1;
$$;

create or replace function mediasis.get_business_cashback_offer(p_domain text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_business uuid := mediasis.resolve_cashback_business(p_domain); v_setting mediasis.business_cashback_settings%rowtype;
begin
  if v_business is null then return jsonb_build_object('success', false, 'message', 'Business not found.'); end if;
  select * into v_setting from mediasis.business_cashback_settings where business_uid = v_business;
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'enabled', coalesce(v_setting.enabled, false),
    'percentage', case when coalesce(v_setting.enabled, false) then coalesce(v_setting.percentage, 0) else 0 end
  ));
end;
$$;

-- Expiry is lazy and idempotent: consumer balance reads and reservations call
-- this function, so expired credits stop being spendable even without a cron.
create or replace function mediasis.expire_business_cashback(
  p_app_user_id uuid,
  p_business_uid uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_lot record; v_remaining bigint;
begin
  for v_lot in
    select oc.order_id, oc.expires_at
    from mediasis.order_cashback oc
    where oc.app_user_id = p_app_user_id
      and oc.business_uid = p_business_uid
      and oc.earning_status = 'available'
      and oc.expires_at <= now()
    order by oc.expires_at, oc.order_id
    for update
  loop
    select coalesce(sum(ce.amount_minor), 0) into v_remaining
    from mediasis.cashback_events ce
    where ce.app_user_id = p_app_user_id
      and ce.business_uid = p_business_uid
      and ce.source_earning_order_id = v_lot.order_id;
    if v_remaining > 0 then
      insert into mediasis.cashback_events (
        app_user_id, business_uid, order_id, source_earning_order_id,
        event_type, amount_minor, idempotency_key, metadata
      ) values (
        p_app_user_id, p_business_uid, v_lot.order_id, v_lot.order_id,
        'expiration', -v_remaining, 'cashback:expiration:' || v_lot.order_id::text,
        jsonb_build_object('expired_at', v_lot.expires_at)
      ) on conflict (idempotency_key) do nothing;
    end if;
    update mediasis.order_cashback set earning_status = 'expired', updated_at = now()
    where order_id = v_lot.order_id and earning_status = 'available';
  end loop;
end;
$$;

create or replace function mediasis.release_cashback_earning(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cashback mediasis.order_cashback%rowtype; v_status text;
begin
  select * into v_cashback from mediasis.order_cashback where order_id = p_order_id for update;
  if not found then return jsonb_build_object('success', true, 'released', false); end if;
  select o.order_status into v_status from mediasis.orders o where o.order_id = p_order_id;
  if v_status <> 'delivered' or v_cashback.app_user_id is null or v_cashback.earned_minor <= 0
     or v_cashback.earning_status in ('available', 'reversed', 'expired') then
    return jsonb_build_object('success', true, 'released', false);
  end if;
  insert into mediasis.cashback_events (
    app_user_id, business_uid, order_id, source_earning_order_id,
    event_type, amount_minor, idempotency_key, expires_at
  ) values (
    v_cashback.app_user_id, v_cashback.business_uid, p_order_id, p_order_id,
    'earning_released', v_cashback.earned_minor,
    'cashback:earning:' || p_order_id::text, now() + interval '1 year'
  ) on conflict (idempotency_key) do nothing;
  update mediasis.order_cashback set
    earning_status = 'available', available_at = coalesce(available_at, now()),
    expires_at = coalesce(expires_at, now() + interval '1 year'), updated_at = now()
  where order_id = p_order_id;
  return jsonb_build_object('success', true, 'released', true);
end;
$$;

create or replace function mediasis.reserve_business_cashback(
  p_order_id uuid,
  p_app_user_id uuid,
  p_business_uid uuid,
  p_amount_minor bigint
) returns void language plpgsql security definer set search_path = '' as $$
declare v_available bigint; v_needed bigint; v_lot record; v_take bigint;
begin
  if p_amount_minor <= 0 then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_app_user_id::text || ':' || p_business_uid::text, 0));
  perform mediasis.expire_business_cashback(p_app_user_id, p_business_uid);
  select coalesce(sum(amount_minor), 0) into v_available
  from mediasis.cashback_events
  where app_user_id = p_app_user_id and business_uid = p_business_uid;
  if v_available < p_amount_minor then raise exception 'Insufficient cashback balance'; end if;
  v_needed := p_amount_minor;
  for v_lot in
    select oc.order_id, oc.expires_at,
      coalesce(sum(ce.amount_minor), 0)::bigint as remaining_minor
    from mediasis.order_cashback oc
    join mediasis.cashback_events ce
      on ce.source_earning_order_id = oc.order_id
     and ce.app_user_id = p_app_user_id and ce.business_uid = p_business_uid
    where oc.app_user_id = p_app_user_id and oc.business_uid = p_business_uid
      and oc.earning_status = 'available'
    group by oc.order_id, oc.expires_at, oc.available_at
    having coalesce(sum(ce.amount_minor), 0) > 0
    order by oc.expires_at asc nulls last, oc.available_at, oc.order_id
  loop
    exit when v_needed = 0;
    v_take := least(v_needed, v_lot.remaining_minor);
    insert into mediasis.cashback_events (
      app_user_id, business_uid, order_id, source_earning_order_id,
      event_type, amount_minor, idempotency_key, metadata
    ) values (
      p_app_user_id, p_business_uid, p_order_id, v_lot.order_id,
      'redemption_reserved', -v_take,
      'cashback:reservation:' || p_order_id::text || ':' || v_lot.order_id::text,
      jsonb_build_object('reserved_minor', v_take)
    );
    v_needed := v_needed - v_take;
  end loop;
  if v_needed <> 0 then raise exception 'Unable to allocate cashback credits'; end if;
end;
$$;

create or replace function mediasis.capture_cashback_redemption(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cashback mediasis.order_cashback%rowtype;
begin
  select * into v_cashback from mediasis.order_cashback where order_id = p_order_id for update;
  if not found or v_cashback.redemption_status <> 'reserved' then
    return jsonb_build_object('success', true, 'captured', false);
  end if;
  insert into mediasis.cashback_events (
    app_user_id, business_uid, order_id, event_type, amount_minor, idempotency_key
  ) values (
    v_cashback.app_user_id, v_cashback.business_uid, p_order_id,
    'redemption_captured', 0, 'cashback:capture:' || p_order_id::text
  ) on conflict (idempotency_key) do nothing;
  update mediasis.order_cashback set redemption_status = 'captured', updated_at = now()
  where order_id = p_order_id;
  return jsonb_build_object('success', true, 'captured', true);
end;
$$;

create or replace function mediasis.release_cashback_reservation(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cashback mediasis.order_cashback%rowtype; v_event record;
begin
  select * into v_cashback from mediasis.order_cashback where order_id = p_order_id for update;
  if not found or v_cashback.redemption_status <> 'reserved' then
    return jsonb_build_object('success', true, 'released', false);
  end if;
  for v_event in
    select reserved.source_earning_order_id,
      greatest(
        -reserved.amount_minor - coalesce((
          select sum(restored.amount_minor)
          from mediasis.cashback_events restored
          where restored.order_id = p_order_id
            and restored.source_earning_order_id = reserved.source_earning_order_id
            and restored.event_type in ('redeemed_cashback_restored', 'refund_adjustment')
            and restored.amount_minor > 0
        ), 0),
        0
      )::bigint as amount_minor
    from mediasis.cashback_events reserved
    where reserved.order_id = p_order_id and reserved.event_type = 'redemption_reserved'
  loop
    continue when v_event.amount_minor <= 0;
    insert into mediasis.cashback_events (
      app_user_id, business_uid, order_id, source_earning_order_id,
      event_type, amount_minor, idempotency_key, metadata
    ) values (
      v_cashback.app_user_id, v_cashback.business_uid, p_order_id,
      v_event.source_earning_order_id, 'reservation_released', v_event.amount_minor,
      'cashback:release:' || p_order_id::text || ':' || v_event.source_earning_order_id::text,
      jsonb_build_object('reason', coalesce(p_reason, 'checkout_failed'))
    ) on conflict (idempotency_key) do nothing;
  end loop;
  update mediasis.order_cashback set redemption_status = 'released', updated_at = now()
  where order_id = p_order_id;
  return jsonb_build_object('success', true, 'released', true);
end;
$$;

create or replace function mediasis.restore_captured_cashback(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cashback mediasis.order_cashback%rowtype; v_event record;
begin
  select * into v_cashback from mediasis.order_cashback where order_id = p_order_id for update;
  if not found or v_cashback.redemption_status <> 'captured' then return; end if;
  for v_event in
    select reserved.source_earning_order_id,
      greatest(
        -reserved.amount_minor - coalesce((
          select sum(restored.amount_minor)
          from mediasis.cashback_events restored
          where restored.order_id = p_order_id
            and restored.source_earning_order_id = reserved.source_earning_order_id
            and restored.event_type in ('redeemed_cashback_restored', 'refund_adjustment')
            and restored.amount_minor > 0
        ), 0),
        0
      )::bigint as amount_minor
    from mediasis.cashback_events reserved
    where reserved.order_id = p_order_id and reserved.event_type = 'redemption_reserved'
  loop
    continue when v_event.amount_minor <= 0;
    insert into mediasis.cashback_events (
      app_user_id, business_uid, order_id, source_earning_order_id,
      event_type, amount_minor, idempotency_key, metadata
    ) values (
      v_cashback.app_user_id, v_cashback.business_uid, p_order_id,
      v_event.source_earning_order_id, 'redeemed_cashback_restored', v_event.amount_minor,
      'cashback:restore:' || p_order_id::text || ':' || v_event.source_earning_order_id::text,
      jsonb_build_object('reason', p_reason)
    ) on conflict (idempotency_key) do nothing;
  end loop;
  update mediasis.order_cashback set redemption_status = 'reversed', updated_at = now()
  where order_id = p_order_id;
end;
$$;

create or replace function mediasis.reverse_cashback_earning(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cashback mediasis.order_cashback%rowtype; v_already_reversed bigint; v_remaining bigint;
begin
  select * into v_cashback from mediasis.order_cashback where order_id = p_order_id for update;
  if not found or v_cashback.earning_status in ('reversed', 'expired') then return; end if;
  if v_cashback.earning_status = 'pending' then
    update mediasis.order_cashback set earning_status = 'reversed', updated_at = now()
    where order_id = p_order_id;
    return;
  end if;
  if v_cashback.app_user_id is null or v_cashback.earned_minor <= 0
     or v_cashback.earning_status <> 'available' then return; end if;
  select coalesce(-sum(amount_minor), 0) into v_already_reversed
  from mediasis.cashback_events
  where order_id = p_order_id
    and event_type in ('earning_reversed', 'refund_adjustment')
    and amount_minor < 0;
  v_remaining := greatest(v_cashback.earned_minor - v_already_reversed, 0);
  if v_remaining = 0 then
    update mediasis.order_cashback set earning_status = 'reversed', updated_at = now()
    where order_id = p_order_id;
    return;
  end if;
  insert into mediasis.cashback_events (
    app_user_id, business_uid, order_id, source_earning_order_id,
    event_type, amount_minor, idempotency_key, metadata
  ) values (
    v_cashback.app_user_id, v_cashback.business_uid, p_order_id, p_order_id,
    'earning_reversed', -v_remaining,
    'cashback:earning-reversal:' || p_order_id::text,
    jsonb_build_object('reason', p_reason)
  ) on conflict (idempotency_key) do nothing;
  update mediasis.order_cashback set earning_status = 'reversed', updated_at = now()
  where order_id = p_order_id;
end;
$$;

create or replace function mediasis.cancel_order_cashback(p_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform mediasis.release_cashback_reservation(p_order_id, p_reason);
  perform mediasis.restore_captured_cashback(p_order_id, p_reason);
  perform mediasis.reverse_cashback_earning(p_order_id, p_reason);
  return jsonb_build_object('success', true);
end;
$$;

create or replace function mediasis.adjust_cashback_for_refund(
  p_order_id uuid,
  p_refund_event_id text,
  p_refunded_eligible_minor bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cashback mediasis.order_cashback%rowtype; v_earned_reversal bigint; v_redeemed_restore bigint;
  v_already_reversed bigint; v_already_restored bigint; v_remaining_restore bigint;
  v_piece bigint; v_reservation record;
begin
  if p_refund_event_id is null or btrim(p_refund_event_id) = '' then raise exception 'Refund event ID required'; end if;
  select * into v_cashback from mediasis.order_cashback where order_id = p_order_id for update;
  if not found then return jsonb_build_object('success', true, 'adjusted', false); end if;
  if p_refunded_eligible_minor <= 0 then raise exception 'Refunded eligible amount must be positive'; end if;
  v_earned_reversal := least(v_cashback.earned_minor,
    round(v_cashback.earned_minor::numeric * least(p_refunded_eligible_minor, v_cashback.eligible_products_minor)::numeric /
      greatest(v_cashback.eligible_products_minor, 1))::bigint);
  v_redeemed_restore := least(v_cashback.redeemed_minor,
    round(v_cashback.redeemed_minor::numeric * least(p_refunded_eligible_minor, v_cashback.eligible_products_minor)::numeric /
      greatest(v_cashback.eligible_products_minor, 1))::bigint);
  select coalesce(-sum(amount_minor), 0) into v_already_reversed
  from mediasis.cashback_events
  where order_id = p_order_id and event_type = 'refund_adjustment' and amount_minor < 0;
  select coalesce(sum(amount_minor), 0) into v_already_restored
  from mediasis.cashback_events
  where order_id = p_order_id and event_type = 'refund_adjustment' and amount_minor > 0;
  v_earned_reversal := least(v_earned_reversal, greatest(v_cashback.earned_minor - v_already_reversed, 0));
  v_redeemed_restore := least(v_redeemed_restore, greatest(v_cashback.redeemed_minor - v_already_restored, 0));
  if v_cashback.app_user_id is not null and v_earned_reversal > 0 and v_cashback.earning_status = 'available' then
    insert into mediasis.cashback_events (
      app_user_id, business_uid, order_id, source_earning_order_id,
      event_type, amount_minor, idempotency_key, metadata
    ) values (
      v_cashback.app_user_id, v_cashback.business_uid, p_order_id, p_order_id,
      'refund_adjustment', -v_earned_reversal,
      'cashback:refund:earning:' || p_refund_event_id,
      jsonb_build_object('refunded_eligible_minor', p_refunded_eligible_minor)
    ) on conflict (idempotency_key) do nothing;
  end if;
  if v_cashback.app_user_id is not null and v_redeemed_restore > 0
     and v_cashback.redemption_status = 'captured' then
    v_remaining_restore := v_redeemed_restore;
    for v_reservation in
      select source_earning_order_id, -amount_minor as reserved_minor
      from mediasis.cashback_events
      where order_id = p_order_id and event_type = 'redemption_reserved'
      order by occurred_at, cashback_event_id
    loop
      exit when v_remaining_restore = 0;
      -- The total restoration is proportional to the refunded product value.
      -- Re-crediting the consumed lots sequentially keeps that exact total and
      -- preserves each source earning's expiration lineage without rounding loss.
      v_piece := least(v_remaining_restore, v_reservation.reserved_minor);
      if v_piece > 0 then
        insert into mediasis.cashback_events (
          app_user_id, business_uid, order_id, source_earning_order_id,
          event_type, amount_minor, idempotency_key, metadata
        ) values (
          v_cashback.app_user_id, v_cashback.business_uid, p_order_id,
          v_reservation.source_earning_order_id, 'refund_adjustment', v_piece,
          'cashback:refund:redemption:' || p_refund_event_id || ':' || v_reservation.source_earning_order_id::text,
          jsonb_build_object('refunded_eligible_minor', p_refunded_eligible_minor)
        ) on conflict (idempotency_key) do nothing;
        v_remaining_restore := v_remaining_restore - v_piece;
      end if;
    end loop;
    if v_remaining_restore > 0 then
      raise exception 'Unable to restore cashback allocation exactly';
    end if;
  end if;
  return jsonb_build_object('success', true, 'adjusted', true,
    'earning_reversed_minor', v_earned_reversal,
    'redemption_restored_minor', v_redeemed_restore);
end;
$$;

create or replace function mediasis.create_checkout_order_with_cashback(
  p_business_location_id uuid,
  p_delivery_price numeric,
  p_products_price numeric,
  p_amount numeric,
  p_payload jsonb,
  p_cashback_eligible_products_minor bigint default 0,
  p_cashback_redemption_minor bigint default 0,
  p_discount_id uuid default null,
  p_discount_code text default null,
  p_discount_amount numeric default null,
  p_discount_breakdown jsonb default null,
  p_order_source text default 'app',
  p_hub_discount_id uuid default null,
  p_hub_delivery_discount_amount numeric default null,
  p_app_user_id uuid default null,
  p_guest_capability_hash text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_order_id uuid; v_business uuid; v_setting mediasis.business_cashback_settings%rowtype;
  v_percentage numeric(5,2) := 0; v_earned bigint := 0;
begin
  if p_cashback_eligible_products_minor < 0 or p_cashback_redemption_minor < 0 then
    return jsonb_build_object('success', false, 'message', 'Invalid cashback amounts.');
  end if;
  if p_cashback_redemption_minor > greatest(p_cashback_eligible_products_minor - 100, 0) then
    return jsonb_build_object('success', false, 'message', 'Cashback must leave at least CRC 1 payable.');
  end if;
  if p_cashback_redemption_minor > 0 and (p_app_user_id is null or p_order_source <> 'app') then
    return jsonb_build_object('success', false, 'message', 'Cashback redemption requires a direct authenticated pharmacy checkout.');
  end if;
  v_result := mediasis.create_checkout_order(
    p_business_location_id, p_delivery_price, p_products_price, p_amount, p_payload,
    p_discount_id, p_discount_code, p_discount_amount, p_discount_breakdown,
    p_order_source, p_hub_discount_id, p_hub_delivery_discount_amount,
    p_app_user_id, p_guest_capability_hash
  );
  if not coalesce((v_result->>'success')::boolean, false) then return v_result; end if;
  v_order_id := (v_result->'data'->>'order_id')::uuid;
  select bl.business_uid into v_business from mediasis.business_location bl
  where bl.business_location_id = p_business_location_id;
  select * into v_setting from mediasis.business_cashback_settings where business_uid = v_business;
  if p_order_source = 'app' and coalesce(v_setting.enabled, false) then
    v_percentage := v_setting.percentage;
    v_earned := round((p_cashback_eligible_products_minor - p_cashback_redemption_minor)::numeric * v_percentage / 100)::bigint;
  end if;
  insert into mediasis.order_cashback (
    order_id, app_user_id, business_uid, percentage, eligible_products_minor,
    earned_minor, redeemed_minor, earning_status, redemption_status
  ) values (
    v_order_id, p_app_user_id, v_business, v_percentage,
    p_cashback_eligible_products_minor,
    v_earned, p_cashback_redemption_minor, 'pending',
    case when p_cashback_redemption_minor > 0 then 'reserved' else 'none' end
  );
  if p_cashback_redemption_minor > 0 then
    perform mediasis.reserve_business_cashback(v_order_id, p_app_user_id, v_business, p_cashback_redemption_minor);
  end if;
  return v_result || jsonb_build_object('cashback', jsonb_build_object(
    'earned_minor', v_earned, 'redeemed_minor', p_cashback_redemption_minor,
    'percentage', v_percentage
  ));
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end;
$$;

create or replace function mediasis.get_my_pharmacy_cashback(p_domain text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := mediasis.current_app_user_id(); v_business uuid := mediasis.resolve_cashback_business(p_domain);
  v_available bigint; v_pending bigint; v_next_expiry timestamptz;
begin
  if v_user is null or v_business is null or not exists (
    select 1 from mediasis.app_users au where au.app_user_id = v_user and au.status = 'active' and au.deleted_at is null
  ) then return jsonb_build_object('success', false, 'message', 'Not authorized.'); end if;
  perform mediasis.expire_business_cashback(v_user, v_business);
  select coalesce(sum(amount_minor), 0) into v_available from mediasis.cashback_events
  where app_user_id = v_user and business_uid = v_business;
  select coalesce(sum(earned_minor), 0) into v_pending from mediasis.order_cashback
  where app_user_id = v_user and business_uid = v_business and earning_status = 'pending';
  select min(expires_at) into v_next_expiry from mediasis.order_cashback
  where app_user_id = v_user and business_uid = v_business
    and earning_status = 'available' and expires_at > now();
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'available_minor', v_available, 'spendable_minor', greatest(v_available, 0),
    'pending_minor', v_pending, 'next_expiration_at', v_next_expiry
  ));
end;
$$;

create or replace function mediasis.get_my_pharmacy_cashback_history(
  p_domain text, p_before timestamptz default null, p_limit integer default 30
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := mediasis.current_app_user_id(); v_business uuid := mediasis.resolve_cashback_business(p_domain);
begin
  if v_user is null or v_business is null then return jsonb_build_object('success', false, 'message', 'Not authorized.'); end if;
  return jsonb_build_object('success', true, 'data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_id', q.cashback_event_id, 'event_type', q.event_type,
      'amount_minor', q.amount_minor, 'occurred_at', q.occurred_at,
      'expires_at', q.expires_at, 'order_id', q.order_id,
      'human_order_number', q.human_order_number
    ) order by q.occurred_at desc, q.cashback_event_id desc)
    from (
      select ce.*, o.human_order_number
      from mediasis.cashback_events ce join mediasis.orders o on o.order_id = ce.order_id
      where ce.app_user_id = v_user and ce.business_uid = v_business
        and (p_before is null or ce.occurred_at < p_before)
      order by ce.occurred_at desc, ce.cashback_event_id desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) q
  ), '[]'::jsonb));
end;
$$;

create or replace function mediasis.get_my_cashback_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := mediasis.current_app_user_id();
begin
  if v_user is null or not exists (
    select 1 from mediasis.app_users au
    where au.app_user_id = v_user and au.status = 'active' and au.deleted_at is null
  ) then return jsonb_build_object('success', false, 'message', 'Not authorized.'); end if;

  -- Expire each pharmacy lazily before presenting its balance.
  perform mediasis.expire_business_cashback(v_user, q.business_uid)
  from (
    select distinct business_uid from mediasis.order_cashback where app_user_id = v_user
  ) q;

  return jsonb_build_object('success', true, 'data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'business_uid', q.business_uid,
      'business_name', q.business_name,
      'business_domain', q.business_domain,
      'available_minor', q.available_minor,
      'spendable_minor', greatest(q.available_minor, 0),
      'pending_minor', q.pending_minor,
      'next_expiration_at', q.next_expiration_at
    ) order by q.business_name)
    from (
      select b.uid as business_uid, b.full_name as business_name,
        bd.domain as business_domain,
        coalesce((select sum(ce.amount_minor) from mediasis.cashback_events ce
          where ce.app_user_id = v_user and ce.business_uid = b.uid), 0)::bigint as available_minor,
        coalesce((select sum(oc.earned_minor) from mediasis.order_cashback oc
          where oc.app_user_id = v_user and oc.business_uid = b.uid
            and oc.earning_status = 'pending'), 0)::bigint as pending_minor,
        (select min(oc.expires_at) from mediasis.order_cashback oc
          where oc.app_user_id = v_user and oc.business_uid = b.uid
            and oc.earning_status = 'available' and oc.expires_at > now()) as next_expiration_at
      from mediasis.businesses b
      join (select distinct business_uid from mediasis.order_cashback where app_user_id = v_user) owned
        on owned.business_uid = b.uid
      left join lateral (
        select d.domain from mediasis.business_domain d
        where d.business_uid = b.uid and d.type = 'order_app'
        order by d.created_at desc, d.business_domain_id desc limit 1
      ) bd on true
    ) q
  ), '[]'::jsonb));
end;
$$;

create or replace function mediasis.get_my_order_cashback(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'percentage', oc.percentage,
        'eligible_products_minor', oc.eligible_products_minor,
        'earned_minor', oc.earned_minor,
        'redeemed_minor', oc.redeemed_minor,
        'earning_status', oc.earning_status,
        'redemption_status', oc.redemption_status,
        'available_at', oc.available_at,
        'expires_at', oc.expires_at
      )
    )
    from mediasis.order_cashback oc
    where oc.order_id = p_order_id and oc.app_user_id = mediasis.current_app_user_id()
  ), jsonb_build_object('success', false, 'message', 'Cashback not found.'));
$$;

create or replace function mediasis.get_my_cashback_history(
  p_before timestamptz default null, p_limit integer default 50
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := mediasis.current_app_user_id();
begin
  if v_user is null then return jsonb_build_object('success', false, 'message', 'Not authorized.'); end if;
  return jsonb_build_object('success', true, 'data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_id', q.cashback_event_id, 'event_type', q.event_type,
      'amount_minor', q.amount_minor, 'occurred_at', q.occurred_at,
      'expires_at', q.expires_at, 'order_id', q.order_id,
      'human_order_number', q.human_order_number,
      'business_name', q.business_name, 'business_domain', q.business_domain
    ) order by q.occurred_at desc, q.cashback_event_id desc)
    from (
      select ce.*, o.human_order_number, b.full_name as business_name, bd.domain as business_domain
      from mediasis.cashback_events ce
      join mediasis.orders o on o.order_id = ce.order_id
      join mediasis.businesses b on b.uid = ce.business_uid
      left join lateral (
        select d.domain from mediasis.business_domain d
        where d.business_uid = b.uid and d.type = 'order_app'
        order by d.created_at desc, d.business_domain_id desc limit 1
      ) bd on true
      where ce.app_user_id = v_user and (p_before is null or ce.occurred_at < p_before)
      order by ce.occurred_at desc, ce.cashback_event_id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) q
  ), '[]'::jsonb));
end;
$$;

create or replace function mediasis.get_order_cashback_summary_service(p_order_id uuid, p_domain text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
        'percentage', oc.percentage,
        'eligible_products_minor', oc.eligible_products_minor,
        'earned_minor', oc.earned_minor,
        'redeemed_minor', oc.redeemed_minor,
        'earning_status', oc.earning_status,
        'redemption_status', oc.redemption_status,
        'available_at', oc.available_at,
        'expires_at', oc.expires_at
      )
    )
    from mediasis.order_cashback oc
    join mediasis.orders o on o.order_id = oc.order_id
    join mediasis.business_location bl on bl.business_location_id = o.business_location_id
    where oc.order_id = p_order_id
      and bl.business_uid = mediasis.resolve_cashback_business(p_domain)
  ), jsonb_build_object('success', false, 'message', 'Cashback not found.'));
$$;

create or replace function mediasis.preview_pharmacy_cashback_redemption(
  p_domain text, p_requested_minor bigint, p_eligible_products_minor bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_balance jsonb; v_available bigint; v_max bigint;
begin
  v_balance := mediasis.get_my_pharmacy_cashback(p_domain);
  if not coalesce((v_balance->>'success')::boolean, false) then return v_balance; end if;
  v_available := (v_balance->'data'->>'spendable_minor')::bigint;
  v_max := least(v_available, greatest(p_eligible_products_minor - 100, 0));
  if p_requested_minor < 0 or p_requested_minor > v_max then
    return jsonb_build_object('success', false, 'message', 'Invalid cashback amount.', 'maximum_minor', v_max);
  end if;
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'requested_minor', p_requested_minor, 'maximum_minor', v_max,
    'remaining_products_minor', p_eligible_products_minor - p_requested_minor
  ));
end;
$$;

create or replace function mediasis.cashback_order_lifecycle_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.app_user_id is not null and old.app_user_id is null then
    update mediasis.order_cashback set app_user_id = new.app_user_id, updated_at = now()
    where order_id = new.order_id and app_user_id is null;
    if new.order_status = 'delivered' then
      perform mediasis.release_cashback_earning(new.order_id);
    end if;
  end if;
  if new.order_status = 'delivered' and old.order_status is distinct from new.order_status then
    perform mediasis.capture_cashback_redemption(new.order_id);
    perform mediasis.release_cashback_earning(new.order_id);
  elsif new.order_status in ('cancelled', 'refunded')
     and old.order_status is distinct from new.order_status then
    perform mediasis.cancel_order_cashback(new.order_id, 'order_cancelled');
  elsif new.products_payment_status = 'refunded'
     and old.products_payment_status is distinct from new.products_payment_status then
    perform mediasis.cancel_order_cashback(new.order_id, 'products_refunded');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_cashback_lifecycle on mediasis.orders;
create trigger orders_cashback_lifecycle
after update of app_user_id, order_status, products_payment_status on mediasis.orders
for each row execute function mediasis.cashback_order_lifecycle_trigger();

revoke all on table mediasis.business_cashback_settings, mediasis.order_cashback, mediasis.cashback_events
  from public, anon, authenticated;
-- Consumer and business reads use the sanitized functions below. Direct table
-- SELECT stays revoked even though owner-scoped RLS policies provide a second
-- boundary, so event metadata and idempotency keys never become browser data.

revoke all on function mediasis.prevent_cashback_event_mutation() from public, anon, authenticated;
revoke all on function mediasis.validate_order_cashback_integrity() from public, anon, authenticated;
revoke all on function mediasis.validate_cashback_event_integrity() from public, anon, authenticated;
revoke all on function mediasis.resolve_cashback_business(text) from public, anon, authenticated;
revoke all on function mediasis.expire_business_cashback(uuid,uuid) from public, anon, authenticated;
revoke all on function mediasis.reserve_business_cashback(uuid,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function mediasis.restore_captured_cashback(uuid,text) from public, anon, authenticated;
revoke all on function mediasis.reverse_cashback_earning(uuid,text) from public, anon, authenticated;
revoke all on function mediasis.cashback_order_lifecycle_trigger() from public, anon, authenticated;

revoke all on function mediasis.get_business_cashback_settings() from public, anon;
revoke all on function mediasis.update_business_cashback_settings(boolean,numeric) from public, anon;
grant execute on function mediasis.get_business_cashback_settings() to authenticated;
grant execute on function mediasis.update_business_cashback_settings(boolean,numeric) to authenticated;

revoke all on function mediasis.get_business_cashback_offer(text) from public, anon, authenticated;
grant execute on function mediasis.get_business_cashback_offer(text) to service_role;

revoke all on function mediasis.get_my_pharmacy_cashback(text) from public, anon;
revoke all on function mediasis.get_my_pharmacy_cashback_history(text,timestamptz,integer) from public, anon;
revoke all on function mediasis.preview_pharmacy_cashback_redemption(text,bigint,bigint) from public, anon;
revoke all on function mediasis.get_my_cashback_overview() from public, anon;
revoke all on function mediasis.get_my_order_cashback(uuid) from public, anon;
revoke all on function mediasis.get_my_cashback_history(timestamptz,integer) from public, anon;
grant execute on function mediasis.get_my_pharmacy_cashback(text) to authenticated;
grant execute on function mediasis.get_my_pharmacy_cashback_history(text,timestamptz,integer) to authenticated;
grant execute on function mediasis.preview_pharmacy_cashback_redemption(text,bigint,bigint) to authenticated;
grant execute on function mediasis.get_my_cashback_overview() to authenticated;
grant execute on function mediasis.get_my_order_cashback(uuid) to authenticated;
grant execute on function mediasis.get_my_cashback_history(timestamptz,integer) to authenticated;

revoke all on function mediasis.get_order_cashback_summary_service(uuid,text) from public, anon, authenticated;
grant execute on function mediasis.get_order_cashback_summary_service(uuid,text) to service_role;

revoke all on function mediasis.create_checkout_order_with_cashback(uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text)
  from public, anon, authenticated;
revoke all on function mediasis.release_cashback_earning(uuid) from public, anon, authenticated;
revoke all on function mediasis.capture_cashback_redemption(uuid) from public, anon, authenticated;
revoke all on function mediasis.release_cashback_reservation(uuid,text) from public, anon, authenticated;
revoke all on function mediasis.adjust_cashback_for_refund(uuid,text,bigint) from public, anon, authenticated;
revoke all on function mediasis.cancel_order_cashback(uuid,text) from public, anon, authenticated;
grant execute on function mediasis.create_checkout_order_with_cashback(uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text) to service_role;
grant execute on function mediasis.release_cashback_earning(uuid) to service_role;
grant execute on function mediasis.capture_cashback_redemption(uuid) to service_role;
grant execute on function mediasis.release_cashback_reservation(uuid,text) to service_role;
grant execute on function mediasis.adjust_cashback_for_refund(uuid,text,bigint) to service_role;
grant execute on function mediasis.cancel_order_cashback(uuid,text) to service_role;

comment on table mediasis.cashback_events is
  'Append-only pharmacy cashback ledger. Balance is SUM(amount_minor) by consumer and business.';
comment on column mediasis.cashback_events.amount_minor is
  'Signed minor units; CRC 1 is stored as 100. Never derive a balance from UI-formatted values.';

commit;

-- Review/verification queries (read only):
-- select relname, relrowsecurity from pg_class where relname in
--   ('business_cashback_settings','order_cashback','cashback_events');
-- select business_uid, app_user_id, sum(amount_minor) balance_minor
--   from mediasis.cashback_events group by business_uid, app_user_id;
-- select routine_name, security_type from information_schema.routines
--   where routine_schema = 'mediasis' and routine_name like '%cashback%';
