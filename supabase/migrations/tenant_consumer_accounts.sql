-- Migration: 021
-- Enable Clerk consumer accounts on explicitly approved pharmacy domains and
-- scope the existing consumer order-history RPCs when a domain is supplied.
-- Review before applying. This migration does not alter order ownership or RLS.

begin;

alter table mediasis.business_domain
  add column if not exists consumer_auth_enabled boolean not null default false;

comment on column mediasis.business_domain.consumer_auth_enabled is
  'True only after this order-app domain is registered and DNS-verified as a Clerk satellite.';

create index if not exists business_domain_consumer_auth_lookup_idx
  on mediasis.business_domain (lower(domain))
  where consumer_auth_enabled = true
    and type = 'order_app'
    and domain is not null;

create or replace function mediasis.normalize_consumer_auth_domain(p_domain text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(p_domain)), '^https?://', ''),
        '[/:].*$', ''
      ),
      '\.$', ''
    ),
    ''
  );
$$;

revoke all on function mediasis.normalize_consumer_auth_domain(text)
  from public, anon, authenticated;

create or replace function mediasis.is_consumer_auth_domain_enabled(p_domain text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from mediasis.business_domain bd
    join mediasis.businesses b
      on b.uid = bd.business_uid
    where bd.type = 'order_app'
      and bd.consumer_auth_enabled = true
      and bd.domain is not null
      and mediasis.normalize_consumer_auth_domain(bd.domain)
          = mediasis.normalize_consumer_auth_domain(p_domain)
      and b.active = true
  );
$$;

revoke all on function mediasis.is_consumer_auth_domain_enabled(text)
  from public, anon, authenticated;
grant execute on function mediasis.is_consumer_auth_domain_enabled(text)
  to service_role;

-- Used only by the primary Clerk provider to build its redirect-origin list.
-- The registry remains inaccessible to browser roles.
create or replace function mediasis.get_consumer_auth_domains()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    array_agg(distinct mediasis.normalize_consumer_auth_domain(bd.domain)),
    array[]::text[]
  )
  from mediasis.business_domain bd
  join mediasis.businesses b
    on b.uid = bd.business_uid
  where bd.type = 'order_app'
    and bd.consumer_auth_enabled = true
    and bd.domain is not null
    and b.active = true;
$$;

revoke all on function mediasis.get_consumer_auth_domains()
  from public, anon, authenticated;
grant execute on function mediasis.get_consumer_auth_domains()
  to service_role;

-- PostgreSQL cannot change an existing function's input signature with
-- CREATE OR REPLACE. Dropping and recreating inside this transaction keeps the
-- public operation atomic. Existing callers pass no domain and retain the
-- complete Mediasis history.
drop function if exists mediasis.get_my_consumer_orders();

create function mediasis.get_my_consumer_orders(p_domain text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'order_id', o.order_id,
      'human_order_number', o.human_order_number,
      'created_at', o.created_at,
      'order_status', o.order_status,
      'products_price', o.products_price,
      'delivery_price', o.delivery_price,
      'amount', o.amount,
      'business_name', b.full_name,
      'business_logo', nullif(btrim(bam.appearance_data->>'logo'), ''),
      'business_domain', bd.domain,
      'business_location_id', o.business_location_id
    ) order by o.created_at desc
  ), '[]'::jsonb)
  from mediasis.orders o
  join mediasis.business_location bl
    on bl.business_location_id = o.business_location_id
  join mediasis.businesses b
    on b.uid = bl.business_uid
  left join mediasis.business_app_metadata bam
    on bam.business_id = b.uid
  left join lateral (
    select candidate.domain
    from mediasis.business_domain candidate
    where candidate.business_uid = b.uid
      and candidate.type = 'order_app'
    order by candidate.created_at desc, candidate.business_domain_id desc
    limit 1
  ) bd on true
  where o.app_user_id = mediasis.current_app_user_id()
    and o.deleted_at is null
    and (
      p_domain is null
      or exists (
        select 1
        from mediasis.business_domain requested_domain
        where requested_domain.business_uid = b.uid
          and requested_domain.type = 'order_app'
          and requested_domain.consumer_auth_enabled = true
          and mediasis.normalize_consumer_auth_domain(requested_domain.domain)
              = mediasis.normalize_consumer_auth_domain(p_domain)
      )
    );
$$;

revoke all on function mediasis.get_my_consumer_orders(text)
  from public, anon;
grant execute on function mediasis.get_my_consumer_orders(text)
  to authenticated;

drop function if exists mediasis.get_my_consumer_order(uuid);

create function mediasis.get_my_consumer_order(
  p_order_id uuid,
  p_domain text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'success', true,
      'data', jsonb_build_object(
      'order_id', o.order_id,
      'human_order_number', o.human_order_number,
      'created_at', o.created_at,
      'order_status', o.order_status,
      'products_price', o.products_price,
      'delivery_price', o.delivery_price,
      'amount', o.amount,
      'discount_code', o.discount_code,
      'discount_amount', o.discount_amount,
      'delivery_method', o.delivery_method,
      'business_name', b.full_name,
      'business_location_name', bl.short_name,
      'business_domain', bd.domain,
      'business_location_id', o.business_location_id
      )
    )
    from mediasis.orders o
    join mediasis.business_location bl
      on bl.business_location_id = o.business_location_id
    join mediasis.businesses b
      on b.uid = bl.business_uid
    left join lateral (
      select candidate.domain
      from mediasis.business_domain candidate
      where candidate.business_uid = b.uid
        and candidate.type = 'order_app'
      order by candidate.created_at desc, candidate.business_domain_id desc
      limit 1
    ) bd on true
    where o.order_id = p_order_id
      and o.app_user_id = mediasis.current_app_user_id()
      and o.deleted_at is null
      and (
        p_domain is null
        or exists (
          select 1
          from mediasis.business_domain requested_domain
          where requested_domain.business_uid = b.uid
            and requested_domain.type = 'order_app'
            and requested_domain.consumer_auth_enabled = true
            and mediasis.normalize_consumer_auth_domain(requested_domain.domain)
                = mediasis.normalize_consumer_auth_domain(p_domain)
        )
      )
    limit 1
  ), jsonb_build_object('success', false, 'message', 'Order not found.'));
$$;

revoke all on function mediasis.get_my_consumer_order(uuid, text)
  from public, anon;
grant execute on function mediasis.get_my_consumer_order(uuid, text)
  to authenticated;

commit;

-- Verification examples (read-only):
-- select mediasis.is_consumer_auth_domain_enabled('pharmacy.example'); -- service role
-- select mediasis.get_my_consumer_orders(null);                           -- authenticated
-- select mediasis.get_my_consumer_orders('pharmacy.example');
