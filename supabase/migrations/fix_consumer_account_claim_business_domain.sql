-- Migration: 017
-- Correct create_consumer_account_claim after migration 008 referenced the
-- nonexistent businesses.domain column. Business domains are stored in the
-- separate mediasis.business_domain table.
--
-- Safe to apply after 008. This only replaces the function definition and
-- does not modify existing orders or account claims.

begin;

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

revoke all on function mediasis.create_consumer_account_claim(uuid, text, text)
  from public, anon, authenticated;
grant execute on function mediasis.create_consumer_account_claim(uuid, text, text)
  to service_role;

commit;
