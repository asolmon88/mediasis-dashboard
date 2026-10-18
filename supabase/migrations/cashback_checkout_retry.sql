-- Migration: 026
-- Atomic cashback reconciliation for editable checkout retries.
--
-- Apply after 025 and before deploying the order app that calls
-- refresh_checkout_order_with_cashback. This migration is additive: the legacy
-- refresh_checkout_order remains available for application rollback.

begin;

alter table mediasis.order_cashback
  add column if not exists reservation_revision integer not null default 0;

alter table mediasis.order_cashback
  drop constraint if exists order_cashback_reservation_revision_valid;

alter table mediasis.order_cashback
  add constraint order_cashback_reservation_revision_valid
  check (reservation_revision >= 0);

comment on column mediasis.order_cashback.reservation_revision is
  'Current reservation generation. Migration-024 events without revision metadata belong to revision 0.';

-- Reserve one revision from credits expiring soonest. The caller owns the
-- order_cashback row lock; the advisory lock serializes all balance mutations
-- for this consumer and pharmacy across different orders.
create or replace function mediasis.reserve_business_cashback_revision(
  p_order_id uuid,
  p_app_user_id uuid,
  p_business_uid uuid,
  p_amount_minor bigint,
  p_revision integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available bigint;
  v_needed bigint;
  v_lot record;
  v_take bigint;
begin
  if p_amount_minor <= 0 then return; end if;
  if p_revision < 0 then raise exception 'Invalid cashback reservation revision'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_app_user_id::text || ':' || p_business_uid::text, 0)
  );
  perform mediasis.expire_business_cashback(p_app_user_id, p_business_uid);

  select coalesce(sum(ce.amount_minor), 0)::bigint
    into v_available
  from mediasis.cashback_events ce
  where ce.app_user_id = p_app_user_id
    and ce.business_uid = p_business_uid;

  if v_available < p_amount_minor then
    raise exception 'Insufficient cashback balance';
  end if;

  v_needed := p_amount_minor;
  for v_lot in
    select oc.order_id,
           oc.expires_at,
           coalesce(sum(ce.amount_minor), 0)::bigint as remaining_minor
    from mediasis.order_cashback oc
    join mediasis.cashback_events ce
      on ce.source_earning_order_id = oc.order_id
     and ce.app_user_id = p_app_user_id
     and ce.business_uid = p_business_uid
    where oc.app_user_id = p_app_user_id
      and oc.business_uid = p_business_uid
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
      'cashback:reservation:' || p_order_id::text || ':r' || p_revision::text || ':' || v_lot.order_id::text,
      pg_catalog.jsonb_build_object(
        'reserved_minor', v_take,
        'reservation_revision', p_revision
      )
    );

    v_needed := v_needed - v_take;
  end loop;

  if v_needed <> 0 then
    raise exception 'Unable to allocate cashback credits';
  end if;
end;
$$;

-- Release only the active reservation generation. Revision metadata was not
-- present in migration 024, so missing metadata is deliberately revision 0.
create or replace function mediasis.release_cashback_reservation(
  p_order_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashback mediasis.order_cashback%rowtype;
  v_event record;
begin
  select * into v_cashback
  from mediasis.order_cashback
  where order_id = p_order_id
  for update;

  if not found or v_cashback.redemption_status <> 'reserved' then
    return pg_catalog.jsonb_build_object('success', true, 'released', false);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_cashback.app_user_id::text || ':' || v_cashback.business_uid::text, 0)
  );

  for v_event in
    select reserved.source_earning_order_id,
           greatest(
             -sum(reserved.amount_minor) - coalesce((
               select sum(returned.amount_minor)
               from mediasis.cashback_events returned
               where returned.order_id = p_order_id
                 and returned.source_earning_order_id = reserved.source_earning_order_id
                 and returned.event_type in (
                   'reservation_released', 'redeemed_cashback_restored', 'refund_adjustment'
                 )
                 and returned.amount_minor > 0
                 and coalesce((returned.metadata->>'reservation_revision')::integer, 0)
                     = v_cashback.reservation_revision
             ), 0),
             0
           )::bigint as amount_minor
    from mediasis.cashback_events reserved
    where reserved.order_id = p_order_id
      and reserved.event_type = 'redemption_reserved'
      and coalesce((reserved.metadata->>'reservation_revision')::integer, 0)
          = v_cashback.reservation_revision
    group by reserved.source_earning_order_id
  loop
    continue when v_event.amount_minor <= 0;

    insert into mediasis.cashback_events (
      app_user_id, business_uid, order_id, source_earning_order_id,
      event_type, amount_minor, idempotency_key, metadata
    ) values (
      v_cashback.app_user_id, v_cashback.business_uid, p_order_id,
      v_event.source_earning_order_id, 'reservation_released', v_event.amount_minor,
      'cashback:release:' || p_order_id::text || ':r' || v_cashback.reservation_revision::text || ':' || v_event.source_earning_order_id::text,
      pg_catalog.jsonb_build_object(
        'reason', coalesce(p_reason, 'checkout_failed'),
        'reservation_revision', v_cashback.reservation_revision
      )
    ) on conflict (idempotency_key) do nothing;
  end loop;

  update mediasis.order_cashback
     set redemption_status = 'released',
         updated_at = pg_catalog.now()
   where order_id = p_order_id;

  return pg_catalog.jsonb_build_object('success', true, 'released', true);
end;
$$;

create or replace function mediasis.capture_cashback_redemption(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashback mediasis.order_cashback%rowtype;
begin
  select * into v_cashback
  from mediasis.order_cashback
  where order_id = p_order_id
  for update;

  if not found or v_cashback.redemption_status <> 'reserved' then
    return pg_catalog.jsonb_build_object('success', true, 'captured', false);
  end if;

  insert into mediasis.cashback_events (
    app_user_id, business_uid, order_id, event_type,
    amount_minor, idempotency_key, metadata
  ) values (
    v_cashback.app_user_id, v_cashback.business_uid, p_order_id,
    'redemption_captured', 0, 'cashback:capture:' || p_order_id::text,
    pg_catalog.jsonb_build_object('reservation_revision', v_cashback.reservation_revision)
  ) on conflict (idempotency_key) do nothing;

  update mediasis.order_cashback
     set redemption_status = 'captured',
         updated_at = pg_catalog.now()
   where order_id = p_order_id;

  return pg_catalog.jsonb_build_object('success', true, 'captured', true);
end;
$$;

-- Restore only the captured generation. Earlier retry generations have already
-- been balanced by reservation_released events and must never be credited again.
create or replace function mediasis.restore_captured_cashback(
  p_order_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashback mediasis.order_cashback%rowtype;
  v_event record;
begin
  select * into v_cashback
  from mediasis.order_cashback
  where order_id = p_order_id
  for update;

  if not found or v_cashback.redemption_status <> 'captured' then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_cashback.app_user_id::text || ':' || v_cashback.business_uid::text, 0)
  );

  for v_event in
    select reserved.source_earning_order_id,
           greatest(
             -sum(reserved.amount_minor) - coalesce((
               select sum(returned.amount_minor)
               from mediasis.cashback_events returned
               where returned.order_id = p_order_id
                 and returned.source_earning_order_id = reserved.source_earning_order_id
                 and returned.event_type in (
                   'reservation_released', 'redeemed_cashback_restored', 'refund_adjustment'
                 )
                 and returned.amount_minor > 0
                 and coalesce((returned.metadata->>'reservation_revision')::integer, 0)
                     = v_cashback.reservation_revision
             ), 0),
             0
           )::bigint as amount_minor
    from mediasis.cashback_events reserved
    where reserved.order_id = p_order_id
      and reserved.event_type = 'redemption_reserved'
      and coalesce((reserved.metadata->>'reservation_revision')::integer, 0)
          = v_cashback.reservation_revision
    group by reserved.source_earning_order_id
  loop
    continue when v_event.amount_minor <= 0;

    insert into mediasis.cashback_events (
      app_user_id, business_uid, order_id, source_earning_order_id,
      event_type, amount_minor, idempotency_key, metadata
    ) values (
      v_cashback.app_user_id, v_cashback.business_uid, p_order_id,
      v_event.source_earning_order_id, 'redeemed_cashback_restored', v_event.amount_minor,
      'cashback:restore:' || p_order_id::text || ':r' || v_cashback.reservation_revision::text || ':' || v_event.source_earning_order_id::text,
      pg_catalog.jsonb_build_object(
        'reason', p_reason,
        'reservation_revision', v_cashback.reservation_revision
      )
    ) on conflict (idempotency_key) do nothing;
  end loop;

  update mediasis.order_cashback
     set redemption_status = 'reversed',
         updated_at = pg_catalog.now()
   where order_id = p_order_id;
end;
$$;

-- Refund restoration is constrained to the captured revision and subtracts
-- prior per-lot restorations before allocating another partial refund.
create or replace function mediasis.adjust_cashback_for_refund(
  p_order_id uuid,
  p_refund_event_id text,
  p_refunded_eligible_minor bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashback mediasis.order_cashback%rowtype;
  v_earned_reversal bigint;
  v_redeemed_restore bigint;
  v_already_reversed bigint;
  v_already_restored bigint;
  v_remaining_restore bigint;
  v_piece bigint;
  v_reservation record;
begin
  if p_refund_event_id is null or pg_catalog.btrim(p_refund_event_id) = '' then
    raise exception 'Refund event ID required';
  end if;

  select * into v_cashback
  from mediasis.order_cashback
  where order_id = p_order_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('success', true, 'adjusted', false);
  end if;
  if p_refunded_eligible_minor <= 0 then
    raise exception 'Refunded eligible amount must be positive';
  end if;

  v_earned_reversal := least(
    v_cashback.earned_minor,
    round(
      v_cashback.earned_minor::numeric
      * least(p_refunded_eligible_minor, v_cashback.eligible_products_minor)::numeric
      / greatest(v_cashback.eligible_products_minor, 1)
    )::bigint
  );
  v_redeemed_restore := least(
    v_cashback.redeemed_minor,
    round(
      v_cashback.redeemed_minor::numeric
      * least(p_refunded_eligible_minor, v_cashback.eligible_products_minor)::numeric
      / greatest(v_cashback.eligible_products_minor, 1)
    )::bigint
  );

  select coalesce(-sum(amount_minor), 0)::bigint
    into v_already_reversed
  from mediasis.cashback_events
  where order_id = p_order_id
    and event_type = 'refund_adjustment'
    and amount_minor < 0;

  select coalesce(sum(amount_minor), 0)::bigint
    into v_already_restored
  from mediasis.cashback_events
  where order_id = p_order_id
    and event_type = 'refund_adjustment'
    and amount_minor > 0
    and coalesce((metadata->>'reservation_revision')::integer, 0)
        = v_cashback.reservation_revision;

  v_earned_reversal := least(
    v_earned_reversal,
    greatest(v_cashback.earned_minor - v_already_reversed, 0)
  );
  v_redeemed_restore := least(
    v_redeemed_restore,
    greatest(v_cashback.redeemed_minor - v_already_restored, 0)
  );

  if v_cashback.app_user_id is not null
     and v_earned_reversal > 0
     and v_cashback.earning_status = 'available' then
    insert into mediasis.cashback_events (
      app_user_id, business_uid, order_id, source_earning_order_id,
      event_type, amount_minor, idempotency_key, metadata
    ) values (
      v_cashback.app_user_id, v_cashback.business_uid, p_order_id, p_order_id,
      'refund_adjustment', -v_earned_reversal,
      'cashback:refund:earning:' || p_refund_event_id,
      pg_catalog.jsonb_build_object('refunded_eligible_minor', p_refunded_eligible_minor)
    ) on conflict (idempotency_key) do nothing;
  end if;

  if v_cashback.app_user_id is not null
     and v_redeemed_restore > 0
     and v_cashback.redemption_status = 'captured' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_cashback.app_user_id::text || ':' || v_cashback.business_uid::text, 0)
    );
    v_remaining_restore := v_redeemed_restore;

    for v_reservation in
      select reserved.source_earning_order_id,
             greatest(
               -sum(reserved.amount_minor) - coalesce((
                 select sum(returned.amount_minor)
                 from mediasis.cashback_events returned
                 where returned.order_id = p_order_id
                   and returned.source_earning_order_id = reserved.source_earning_order_id
                   and returned.event_type in ('redeemed_cashback_restored', 'refund_adjustment')
                   and returned.amount_minor > 0
                   and coalesce((returned.metadata->>'reservation_revision')::integer, 0)
                       = v_cashback.reservation_revision
               ), 0),
               0
             )::bigint as available_minor
      from mediasis.cashback_events reserved
      where reserved.order_id = p_order_id
        and reserved.event_type = 'redemption_reserved'
        and coalesce((reserved.metadata->>'reservation_revision')::integer, 0)
            = v_cashback.reservation_revision
      group by reserved.source_earning_order_id
      order by min(reserved.occurred_at), reserved.source_earning_order_id
    loop
      exit when v_remaining_restore = 0;
      v_piece := least(v_remaining_restore, v_reservation.available_minor);
      continue when v_piece <= 0;

      insert into mediasis.cashback_events (
        app_user_id, business_uid, order_id, source_earning_order_id,
        event_type, amount_minor, idempotency_key, metadata
      ) values (
        v_cashback.app_user_id, v_cashback.business_uid, p_order_id,
        v_reservation.source_earning_order_id, 'refund_adjustment', v_piece,
        'cashback:refund:redemption:' || p_refund_event_id || ':r' || v_cashback.reservation_revision::text || ':' || v_reservation.source_earning_order_id::text,
        pg_catalog.jsonb_build_object(
          'refunded_eligible_minor', p_refunded_eligible_minor,
          'reservation_revision', v_cashback.reservation_revision
        )
      ) on conflict (idempotency_key) do nothing;

      v_remaining_restore := v_remaining_restore - v_piece;
    end loop;

    if v_remaining_restore > 0 then
      raise exception 'Unable to restore cashback allocation exactly';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'success', true,
    'adjusted', true,
    'earning_reversed_minor', v_earned_reversal,
    'redemption_restored_minor', v_redeemed_restore
  );
end;
$$;

create or replace function mediasis.refresh_checkout_order_with_cashback(
  p_order_id uuid,
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
  p_hub_discount_id uuid default null,
  p_hub_delivery_discount_amount numeric default null,
  p_app_user_id uuid default null,
  p_guest_capability_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order mediasis.orders%rowtype;
  v_cashback mediasis.order_cashback%rowtype;
  v_business_uid uuid;
  v_revision integer;
  v_earned_minor bigint;
begin
  begin
    if p_cashback_eligible_products_minor < 0 or p_cashback_redemption_minor < 0 then
      raise exception 'Invalid cashback amounts';
    end if;
    if p_cashback_redemption_minor
       > greatest(p_cashback_eligible_products_minor - 100, 0) then
      raise exception 'Cashback must leave at least CRC 1 payable';
    end if;

    -- The base command owns all cart, actor, tenant, payment-method and order
    -- editability validation. Any later cashback exception rolls this call back
    -- because this nested block is one PostgreSQL subtransaction.
    v_result := mediasis.refresh_checkout_order(
      p_order_id,
      p_business_location_id,
      p_delivery_price,
      p_products_price,
      p_amount,
      p_payload,
      p_discount_id,
      p_discount_code,
      p_discount_amount,
      p_discount_breakdown,
      p_hub_discount_id,
      p_hub_delivery_discount_amount,
      p_app_user_id,
      p_guest_capability_hash
    );

    if not coalesce((v_result->>'success')::boolean, false) then
      return v_result;
    end if;

    select o.* into v_order
    from mediasis.orders o
    where o.order_id = p_order_id
    for update;

    select oc.* into v_cashback
    from mediasis.order_cashback oc
    where oc.order_id = p_order_id
    for update;

    if not found then
      select bl.business_uid into v_business_uid
      from mediasis.business_location bl
      where bl.business_location_id = v_order.business_location_id;

      if p_cashback_redemption_minor > 0 then
        raise exception 'Cashback is unavailable for this existing order';
      end if;

      insert into mediasis.order_cashback (
        order_id, app_user_id, business_uid, percentage,
        eligible_products_minor, earned_minor, redeemed_minor,
        earning_status, redemption_status, reservation_revision
      ) values (
        p_order_id, v_order.app_user_id, v_business_uid, 0,
        p_cashback_eligible_products_minor, 0, 0,
        'pending', 'none', 0
      ) returning * into v_cashback;
    end if;

    if v_cashback.redemption_status in ('captured', 'reversed') then
      raise exception 'Finalized cashback cannot be refreshed';
    end if;
    if p_cashback_redemption_minor > 0 and (
      v_order.order_source is distinct from 'app'
      or v_order.app_user_id is null
      or v_cashback.app_user_id is distinct from v_order.app_user_id
    ) then
      raise exception 'Cashback redemption requires a direct authenticated pharmacy checkout';
    end if;

    if v_cashback.redemption_status = 'reserved' then
      perform mediasis.release_cashback_reservation(p_order_id, 'checkout_retry');
    end if;

    v_revision := v_cashback.reservation_revision + 1;
    v_earned_minor := case
      when v_order.order_source = 'app' then
        round(
          (p_cashback_eligible_products_minor - p_cashback_redemption_minor)::numeric
          * v_cashback.percentage / 100
        )::bigint
      else 0
    end;

    if p_cashback_redemption_minor > 0 then
      perform mediasis.reserve_business_cashback_revision(
        p_order_id,
        v_order.app_user_id,
        v_cashback.business_uid,
        p_cashback_redemption_minor,
        v_revision
      );
    end if;

    update mediasis.order_cashback
       set eligible_products_minor = p_cashback_eligible_products_minor,
           earned_minor = v_earned_minor,
           redeemed_minor = p_cashback_redemption_minor,
           earning_status = 'pending',
           redemption_status = case
             when p_cashback_redemption_minor > 0 then 'reserved'
             else 'none'
           end,
           reservation_revision = v_revision,
           updated_at = pg_catalog.now()
     where order_id = p_order_id;

    return v_result || pg_catalog.jsonb_build_object(
      'cashback', pg_catalog.jsonb_build_object(
        'eligible_products_minor', p_cashback_eligible_products_minor,
        'earned_minor', v_earned_minor,
        'redeemed_minor', p_cashback_redemption_minor,
        'percentage', v_cashback.percentage,
        'reservation_revision', v_revision
      )
    );
  exception when others then
    return pg_catalog.jsonb_build_object('success', false, 'message', sqlerrm);
  end;
end;
$$;

revoke all on function mediasis.reserve_business_cashback_revision(uuid,uuid,uuid,bigint,integer)
  from public, anon, authenticated;
revoke all on function mediasis.refresh_checkout_order_with_cashback(
  uuid,uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text
) from public, anon, authenticated;

-- These are trigger/service helpers and must never be browser-callable.
revoke all on function mediasis.release_cashback_reservation(uuid,text)
  from public, anon, authenticated;
revoke all on function mediasis.capture_cashback_redemption(uuid)
  from public, anon, authenticated;
revoke all on function mediasis.restore_captured_cashback(uuid,text)
  from public, anon, authenticated;
revoke all on function mediasis.adjust_cashback_for_refund(uuid,text,bigint)
  from public, anon, authenticated;

grant execute on function mediasis.refresh_checkout_order_with_cashback(
  uuid,uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text
) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'mediasis'
      and c.relname = 'order_cashback'
      and a.attname = 'reservation_revision'
      and not a.attisdropped
  ) then
    raise exception 'order_cashback.reservation_revision was not installed';
  end if;

  if has_function_privilege(
       'anon',
       'mediasis.refresh_checkout_order_with_cashback(uuid,uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text)',
       'EXECUTE'
     ) or has_function_privilege(
       'authenticated',
       'mediasis.refresh_checkout_order_with_cashback(uuid,uuid,numeric,numeric,numeric,jsonb,bigint,bigint,uuid,text,numeric,jsonb,uuid,numeric,uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'An API-facing role can execute the cashback retry command';
  end if;
end;
$$;

commit;

-- POST-APPLY READ-ONLY VERIFICATION
-- select column_name, data_type, column_default, is_nullable
-- from information_schema.columns
-- where table_schema = 'mediasis' and table_name = 'order_cashback'
--   and column_name = 'reservation_revision';
--
-- select p.proname, p.prosecdef, p.proconfig, p.proacl
-- from pg_catalog.pg_proc p
-- join pg_catalog.pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'mediasis'
--   and p.proname in (
--     'refresh_checkout_order_with_cashback',
--     'reserve_business_cashback_revision',
--     'release_cashback_reservation',
--     'restore_captured_cashback',
--     'adjust_cashback_for_refund'
--   );
--
-- select order_id, reservation_revision, redeemed_minor, redemption_status
-- from mediasis.order_cashback
-- order by updated_at desc limit 25;

-- APPLICATION ROLLBACK
-- Deploy the previous order app first so it calls refresh_checkout_order.
-- The new column and functions are intentionally retained: removing them while
-- revisioned ledger events exist would make refund lineage ambiguous.
