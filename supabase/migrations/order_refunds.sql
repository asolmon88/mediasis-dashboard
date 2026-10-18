-- Migration: 033
-- Persist ONVO product-payment refunds for idempotency, audit, and receipts.

create table if not exists mediasis.order_refunds (
  order_refund_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references mediasis.orders(order_id) on delete cascade,
  payment_intent_id text not null,
  provider text not null default 'onvo',
  provider_refund_id text,
  amount_minor bigint,
  currency text,
  status text not null default 'creating'
    check (status in ('creating', 'pending', 'succeeded', 'failed')),
  reason text,
  description text,
  mode text check (mode is null or mode in ('test', 'live')),
  failure_reason text,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  authorization_number text,
  reference_number text,
  transaction_reference text,
  merchant_name text,
  initiated_by uuid,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists order_refunds_provider_refund_id_unique
  on mediasis.order_refunds(provider, provider_refund_id)
  where provider_refund_id is not null;

create unique index if not exists order_refunds_one_open_full_refund
  on mediasis.order_refunds(provider, payment_intent_id)
  where status in ('creating', 'pending', 'succeeded');

create index if not exists order_refunds_order_created_idx
  on mediasis.order_refunds(order_id, created_at desc);

alter table mediasis.order_refunds enable row level security;

revoke all on table mediasis.order_refunds from public, anon, authenticated;
grant select, insert, update on table mediasis.order_refunds to service_role;

comment on table mediasis.order_refunds is
  'Server-only audit and idempotency records for product-payment refunds.';
