-- Explicit rollback for 008/009. Refuses rollback once consumer data is in use.

begin;

do $$
begin
  if exists (select 1 from mediasis.orders where app_user_id is not null)
     or exists (select 1 from mediasis.cart where app_user_id is not null)
     or exists (select 1 from mediasis.client where app_user_id is not null)
     or exists (select 1 from mediasis.consumer_account_claims) then
    raise exception 'Consumer authorization records are in use; reviewed data migration required';
  end if;
end
$$;

drop policy if exists consumer_profiles_select_own on mediasis.consumer_profiles;
drop policy if exists app_users_consumer_select_own on mediasis.app_users;
drop function if exists mediasis.get_my_consumer_order(uuid);
drop function if exists mediasis.get_my_consumer_orders();
drop function if exists mediasis.update_my_consumer_profile(text);
drop function if exists mediasis.consume_consumer_account_claim(text, uuid);
drop function if exists mediasis.create_consumer_account_claim(uuid, text, text);
drop trigger if exists consumer_account_claim_logical_delete_only on mediasis.consumer_account_claims;
drop trigger if exists client_prevent_consumer_owner_reassignment on mediasis.client;
drop trigger if exists orders_prevent_consumer_owner_reassignment on mediasis.orders;
drop trigger if exists client_consumer_logical_delete_only on mediasis.client;
drop trigger if exists cart_consumer_logical_delete_only on mediasis.cart;
drop trigger if exists orders_consumer_logical_delete_only on mediasis.orders;
drop function if exists mediasis.prevent_consumer_claim_delete();
drop function if exists mediasis.prevent_owned_commerce_delete();
drop function if exists mediasis.prevent_consumer_owner_reassignment();
drop table if exists mediasis.consumer_account_claims;
alter table mediasis.orders drop constraint if exists orders_app_user_fk;
alter table mediasis.cart drop constraint if exists cart_app_user_fk;
alter table mediasis.client drop constraint if exists client_app_user_fk;
alter table mediasis.orders drop column if exists app_user_id;
alter table mediasis.cart drop column if exists app_user_id;
alter table mediasis.client drop column if exists app_user_id;

-- deleted_at columns are deliberately retained because they may have existed
-- before this draft and are harmless additive soft-delete infrastructure.

commit;
