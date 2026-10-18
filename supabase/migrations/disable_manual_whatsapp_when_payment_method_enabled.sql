-- Migration: 035
begin;

-- Remove the superseded business-wide implementation if it was applied before
-- WhatsApp behavior became location-specific.
drop trigger if exists trg_disable_legacy_whatsapp_when_payment_method_added
  on mediasis.business_payment_method;
drop trigger if exists trg_enforce_legacy_whatsapp_payment_method_eligibility
  on mediasis.business_app_metadata;
drop function if exists mediasis.disable_legacy_whatsapp_when_payment_method_added();
drop function if exists mediasis.enforce_legacy_whatsapp_payment_method_eligibility();

create or replace function mediasis.remove_manual_whatsapp_locations(
  p_business_id uuid,
  p_location_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path to 'mediasis', 'public', 'pg_catalog'
as $function$
begin
  if p_location_ids is null or cardinality(p_location_ids) = 0 then
    return;
  end if;

  update mediasis.business_app_metadata bam
  set checkout_data = jsonb_set(
    coalesce(bam.checkout_data, '{}'::jsonb),
    '{customer_sends_whatsapp_manually_location_ids}',
    coalesce(
      (
        select jsonb_agg(location_id)
        from jsonb_array_elements_text(
          coalesce(
            bam.checkout_data -> 'customer_sends_whatsapp_manually_location_ids',
            '[]'::jsonb
          )
        ) as configured(location_id)
        where not (configured.location_id::uuid = any(p_location_ids))
      ),
      '[]'::jsonb
    ),
    true
  )
  where bam.business_id = p_business_id
    and jsonb_array_length(
      coalesce(
        bam.checkout_data -> 'customer_sends_whatsapp_manually_location_ids',
        '[]'::jsonb
      )
    ) > 0;
end;
$function$;

revoke all on function mediasis.remove_manual_whatsapp_locations(uuid, uuid[]) from public;

create or replace function mediasis.disable_manual_whatsapp_for_payment_method()
returns trigger
language plpgsql
security definer
set search_path to 'mediasis', 'public', 'pg_catalog'
as $function$
declare
  v_location_ids uuid[];
begin
  if not coalesce(new.visible, true) then
    return new;
  end if;

  if coalesce(new.scope, 'all') = 'all' then
    select array_agg(bl.business_location_id)
    into v_location_ids
    from mediasis.business_location bl
    where bl.business_uid = new.business_id;
  else
    select array_agg(bpml.business_location_id)
    into v_location_ids
    from mediasis.business_payment_method_location bpml
    where bpml.business_payment_method_id = new.business_payment_method_id;
  end if;

  perform mediasis.remove_manual_whatsapp_locations(new.business_id, v_location_ids);
  return new;
end;
$function$;

revoke all on function mediasis.disable_manual_whatsapp_for_payment_method() from public;

drop trigger if exists trg_disable_manual_whatsapp_for_payment_method
  on mediasis.business_payment_method;

create trigger trg_disable_manual_whatsapp_for_payment_method
after insert or update of visible, scope on mediasis.business_payment_method
for each row
execute function mediasis.disable_manual_whatsapp_for_payment_method();

create or replace function mediasis.disable_manual_whatsapp_for_payment_method_location()
returns trigger
language plpgsql
security definer
set search_path to 'mediasis', 'public', 'pg_catalog'
as $function$
declare
  v_business_id uuid;
  v_visible boolean;
begin
  select bpm.business_id, coalesce(bpm.visible, true)
  into v_business_id, v_visible
  from mediasis.business_payment_method bpm
  where bpm.business_payment_method_id = new.business_payment_method_id;

  if v_visible then
    perform mediasis.remove_manual_whatsapp_locations(
      v_business_id,
      array[new.business_location_id]
    );
  end if;

  return new;
end;
$function$;

revoke all on function mediasis.disable_manual_whatsapp_for_payment_method_location() from public;

drop trigger if exists trg_disable_manual_whatsapp_for_payment_method_location
  on mediasis.business_payment_method_location;

create trigger trg_disable_manual_whatsapp_for_payment_method_location
after insert or update of business_location_id on mediasis.business_payment_method_location
for each row
execute function mediasis.disable_manual_whatsapp_for_payment_method_location();

commit;
