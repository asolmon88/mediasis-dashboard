-- Migration: 050
-- Purpose: Preserve the JSONB type of delivery_methods_business.fee in the atomic Delivery save RPC.
-- Apply after migration 049. This file is not applied automatically.

begin;

do $$
declare
  v_definition text;
  v_corrected text;
  v_incorrect_expression constant text := 'nullif((p_payload->>''fee'')::numeric, 0)';
  v_correct_expression constant text := $replacement$case
          when coalesce(p_payload->'fee', 'null'::jsonb) in ('null'::jsonb, '0'::jsonb) then null
          else p_payload->'fee'
        end$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'mediasis.save_ordering_app_delivery_method(uuid,uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'Migration 049 save_ordering_app_delivery_method function is missing';
  end if;

  v_corrected := pg_catalog.replace(v_definition, v_incorrect_expression, v_correct_expression);
  if v_corrected = v_definition then
    raise exception 'Expected migration 049 fee expression was not found';
  end if;

  execute v_corrected;
end;
$$;

revoke all on function mediasis.save_ordering_app_delivery_method(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function mediasis.save_ordering_app_delivery_method(uuid, uuid, uuid, jsonb)
to service_role;

commit;

-- Rollback:
-- Reapply migration 049's original function only after disabling Delivery writes.
