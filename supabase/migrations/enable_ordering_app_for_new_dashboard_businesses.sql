-- Migration: 071
-- Purpose: Enable the ordering app and disable reservations for businesses
--          created through dashboard provisioning.

begin;

create or replace function mediasis.enforce_dashboard_business_creation_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    update mediasis.businesses
    set app_active = true
    where uid = new.business_id;

    update mediasis.business_location
    set reservation_active = false
    where business_uid = new.business_id
      and business_location_id = new.business_location_id;
  end if;

  return new;
end;
$$;

drop trigger if exists dashboard_business_creation_defaults
  on mediasis.business_provisioning_requests;
create trigger dashboard_business_creation_defaults
after insert or update of status on mediasis.business_provisioning_requests
for each row
execute function mediasis.enforce_dashboard_business_creation_defaults();

revoke all on function mediasis.enforce_dashboard_business_creation_defaults()
  from public, anon, authenticated, service_role;

commit;
