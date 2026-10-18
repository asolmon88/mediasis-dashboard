-- Migration: 063
-- Purpose: Let Clerk-native businesses use a permanent business UUID without
-- requiring a matching legacy Supabase Auth user.
-- Apply after migration 062. This file is not applied automatically.

begin;

do $$
declare
  v_constraint_definition text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid)
  into v_constraint_definition
  from pg_catalog.pg_constraint c
  where c.conrelid = 'mediasis.businesses'::regclass
    and c.conname = 'businesses_uid_fkey'
    and c.contype = 'f';

  if v_constraint_definition is null then
    -- Idempotent replay: the legacy identity constraint was already removed.
    return;
  end if;

  -- Fail closed if production contains a different constraint with this name.
  -- This migration is authorized to remove only uid -> auth.users(id).
  if v_constraint_definition not like 'FOREIGN KEY (uid) REFERENCES auth.users(id)%' then
    raise exception 'Unexpected businesses_uid_fkey definition: %', v_constraint_definition;
  end if;

  alter table mediasis.businesses drop constraint businesses_uid_fkey;
end;
$$;

comment on column mediasis.businesses.uid is
  'Permanent business identifier. Legacy businesses may share this UUID with auth.users; Clerk-native businesses do not require a Supabase Auth user.';

commit;
