-- Migration: 029
-- 029_cashback_account_branding_and_expiration.sql
-- Reviewable draft only. Do not apply automatically.
--
-- 1. Newly released cashback expires three months after it becomes available.
-- 2. Existing available cashback keeps its previously assigned expiration.
-- 3. The consumer cashback overview includes each business logo.
--
-- Apply after 027. This migration does not update existing cashback rows or
-- recreate the order lifecycle trigger.

begin;

do $$
begin
  if pg_catalog.to_regprocedure('mediasis.cashback_discount_present(uuid,text,numeric,uuid,numeric)') is null then
    raise exception 'Migration 028 is required before migration 029';
  end if;

  if pg_catalog.to_regprocedure('mediasis.release_cashback_earning(uuid)') is null then
    raise exception 'Migration 024 is required before migration 029';
  end if;

  if pg_catalog.to_regprocedure('mediasis.get_my_cashback_overview()') is null then
    raise exception 'Migration 024 is required before migration 029';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'mediasis'
      and t.typname = 'order_status'
      and e.enumlabel = 'ready'
  ) or not exists (
    select 1
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    join pg_catalog.pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'mediasis'
      and t.typname = 'order_status'
      and e.enumlabel = 'delivered'
  ) then
    raise exception 'Migration 027 is required before migration 029';
  end if;

  if pg_catalog.to_regprocedure('mediasis.cashback_order_lifecycle_trigger()') is null
     or position(
       'ready' in pg_catalog.pg_get_functiondef(
         pg_catalog.to_regprocedure('mediasis.cashback_order_lifecycle_trigger()')
       )
     ) = 0 then
    raise exception 'Migration 027 lifecycle trigger function is required before migration 029';
  end if;
end;
$$;

-- Preserve migration 027's ready/delivered completion rule. Only the expiry
-- assigned to a newly released earning changes from one year to three months.
create or replace function mediasis.release_cashback_earning(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashback mediasis.order_cashback%rowtype;
  v_status text;
  v_released_at timestamptz := pg_catalog.now();
  v_expires_at timestamptz := v_released_at + interval '3 months';
begin
  select * into v_cashback
  from mediasis.order_cashback
  where order_id = p_order_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('success', true, 'released', false);
  end if;

  select o.order_status::text into v_status
  from mediasis.orders o
  where o.order_id = p_order_id;

  if v_status is null
     or v_status not in ('ready', 'delivered')
     or v_cashback.app_user_id is null
     or v_cashback.earned_minor <= 0
     or v_cashback.earning_status in ('available', 'reversed', 'expired') then
    return pg_catalog.jsonb_build_object('success', true, 'released', false);
  end if;

  insert into mediasis.cashback_events (
    app_user_id, business_uid, order_id, source_earning_order_id,
    event_type, amount_minor, idempotency_key, expires_at, metadata
  ) values (
    v_cashback.app_user_id, v_cashback.business_uid, p_order_id, p_order_id,
    'earning_released', v_cashback.earned_minor,
    'cashback:earning:' || p_order_id::text,
    v_expires_at,
    pg_catalog.jsonb_build_object('completion_status', v_status)
  ) on conflict (idempotency_key) do nothing;

  -- If an idempotency event already exists, preserve the expiry recorded by
  -- that original release instead of silently changing an earlier promise.
  select ce.expires_at into v_expires_at
  from mediasis.cashback_events ce
  where ce.idempotency_key = 'cashback:earning:' || p_order_id::text;

  update mediasis.order_cashback
     set earning_status = 'available',
         available_at = coalesce(available_at, v_released_at),
         expires_at = coalesce(expires_at, v_expires_at),
         updated_at = pg_catalog.now()
   where order_id = p_order_id;

  return pg_catalog.jsonb_build_object('success', true, 'released', true);
end;
$$;

revoke all on function mediasis.release_cashback_earning(uuid)
  from public, anon, authenticated;
grant execute on function mediasis.release_cashback_earning(uuid)
  to service_role;

-- Extend the existing safe consumer overview. No payment, authorization, or
-- internal business metadata is exposed beyond the already public logo URL.
create or replace function mediasis.get_my_cashback_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := mediasis.current_app_user_id();
begin
  if v_user is null or not exists (
    select 1
    from mediasis.app_users au
    where au.app_user_id = v_user
      and au.status = 'active'
      and au.deleted_at is null
  ) then
    return pg_catalog.jsonb_build_object('success', false, 'message', 'Not authorized.');
  end if;

  perform mediasis.expire_business_cashback(v_user, q.business_uid)
  from (
    select distinct business_uid
    from mediasis.order_cashback
    where app_user_id = v_user
  ) q;

  return pg_catalog.jsonb_build_object('success', true, 'data', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'business_uid', q.business_uid,
      'business_name', q.business_name,
      'business_domain', q.business_domain,
      'business_logo', q.business_logo,
      'available_minor', q.available_minor,
      'spendable_minor', greatest(q.available_minor, 0),
      'pending_minor', q.pending_minor,
      'next_expiration_at', q.next_expiration_at
    ) order by q.business_name)
    from (
      select
        b.uid as business_uid,
        b.full_name as business_name,
        bd.domain as business_domain,
        nullif(pg_catalog.btrim(bam.appearance_data->>'logo'), '') as business_logo,
        coalesce((
          select pg_catalog.sum(ce.amount_minor)
          from mediasis.cashback_events ce
          where ce.app_user_id = v_user
            and ce.business_uid = b.uid
        ), 0)::bigint as available_minor,
        coalesce((
          select pg_catalog.sum(oc.earned_minor)
          from mediasis.order_cashback oc
          where oc.app_user_id = v_user
            and oc.business_uid = b.uid
            and oc.earning_status = 'pending'
        ), 0)::bigint as pending_minor,
        (
          select pg_catalog.min(oc.expires_at)
          from mediasis.order_cashback oc
          where oc.app_user_id = v_user
            and oc.business_uid = b.uid
            and oc.earning_status = 'available'
            and oc.expires_at > pg_catalog.now()
        ) as next_expiration_at
      from mediasis.businesses b
      join (
        select distinct business_uid
        from mediasis.order_cashback
        where app_user_id = v_user
      ) owned on owned.business_uid = b.uid
      left join mediasis.business_app_metadata bam
        on bam.business_id = b.uid
      left join lateral (
        select d.domain
        from mediasis.business_domain d
        where d.business_uid = b.uid
          and d.type = 'order_app'
        order by d.created_at desc, d.business_domain_id desc
        limit 1
      ) bd on true
    ) q
  ), '[]'::jsonb));
end;
$$;

revoke all on function mediasis.get_my_cashback_overview()
  from public, anon;
grant execute on function mediasis.get_my_cashback_overview()
  to authenticated;

do $$
begin
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'mediasis.get_my_cashback_overview()',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute get_my_cashback_overview';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'mediasis.get_my_cashback_overview()',
    'EXECUTE'
  ) then
    raise exception 'anon must not execute get_my_cashback_overview';
  end if;
end;
$$;

commit;

-- POST-APPLY READ-ONLY VERIFICATION
--
-- Existing available cashback dates must remain unchanged:
-- select order_id, available_at, expires_at
-- from mediasis.order_cashback
-- where earning_status = 'available'
-- order by available_at desc;
--
-- New releases should be approximately three months apart:
-- select order_id, available_at, expires_at,
--        expires_at - available_at as validity
-- from mediasis.order_cashback
-- where earning_status = 'available'
-- order by available_at desc limit 25;
--
-- The authenticated RPC response should include business_logo without exposing
-- another consumer's records:
-- select mediasis.get_my_cashback_overview();

-- ROLLBACK NOTE
-- Reapply the release_cashback_earning definition from migration 027 to return
-- future releases to one year. Do not alter expiration dates already assigned
-- while this migration was active. Reapply the overview definition from 024 if
-- the logo field must be removed.
