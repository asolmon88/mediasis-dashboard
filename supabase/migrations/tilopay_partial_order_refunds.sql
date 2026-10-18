begin;

alter table mediasis.order_refunds
  add column if not exists refund_kind text not null default 'full';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'mediasis.order_refunds'::regclass
      and conname = 'order_refunds_kind_check'
  ) then
    alter table mediasis.order_refunds
      add constraint order_refunds_kind_check
      check (refund_kind in ('full', 'partial'));
  end if;
end
$$;

drop index if exists mediasis.order_refunds_one_open_full_refund;

create unique index if not exists order_refunds_one_open_request
  on mediasis.order_refunds(provider, payment_intent_id)
  where status in ('creating', 'pending');

comment on column mediasis.order_refunds.refund_kind is
  'Whether the refund returns the remaining payment balance or only a merchant-entered portion.';

commit;
