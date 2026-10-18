-- Migration: 060
-- Purpose: Remove temporary legacy migration infrastructure after successful reconciliation.

begin;

do $$
declare v_verification jsonb;
begin
  v_verification := mediasis.verify_legacy_business_clerk_migration();
  if coalesce((v_verification->>'ready_for_cleanup')::boolean, false) is not true then
    raise exception 'Legacy Clerk migration is incomplete; cleanup refused: %', v_verification;
  end if;
end
$$;

drop function if exists mediasis.get_legacy_business_clerk_migration_preflight(uuid);
drop function if exists mediasis.prepare_legacy_business_clerk_migration(uuid);
drop function if exists mediasis.checkpoint_legacy_business_clerk_migration(uuid,text,text,text,text);
drop function if exists mediasis.fail_legacy_business_clerk_migration(uuid,text,text,boolean);
drop function if exists mediasis.complete_legacy_business_clerk_migration(uuid,text,text,text);
drop function if exists mediasis.verify_legacy_business_clerk_migration();
drop table if exists mediasis.legacy_business_clerk_migrations;

commit;
