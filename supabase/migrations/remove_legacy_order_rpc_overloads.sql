-- Migration: 013
-- Cleanup after the order application is deployed against migration 012.
-- Do not apply before create_checkout_order/refresh_checkout_order are live.

begin;

do $$
begin
  if pg_catalog.to_regprocedure(
    'mediasis.create_checkout_order(uuid,numeric,numeric,numeric,jsonb,uuid,text,numeric,jsonb,text,uuid,numeric,uuid,text)'
  ) is null or pg_catalog.to_regprocedure(
    'mediasis.refresh_checkout_order(uuid,uuid,numeric,numeric,numeric,jsonb,uuid,text,numeric,jsonb,uuid,numeric,uuid,text)'
  ) is null then
    raise exception 'Secure checkout commands are not installed';
  end if;
end
$$;

drop function if exists mediasis.insert_order(
  uuid, numeric, numeric, numeric, jsonb
);

drop function if exists mediasis.insert_order(
  uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric, jsonb,
  text, uuid, numeric
);

drop function if exists mediasis.insert_order(
  uuid, text, numeric, numeric, numeric, text, jsonb
);

drop function if exists mediasis.update_order_checkout_data(
  uuid, uuid, numeric, numeric, numeric, jsonb, uuid, text, numeric,
  jsonb, uuid, numeric
);

commit;
