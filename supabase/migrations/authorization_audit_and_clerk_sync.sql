-- Migration: 004
-- Authorization audit trail and idempotent Clerk webhook processing.
-- Depends on 001-003.

begin;

create table if not exists mediasis.authorization_audit_log (
  authorization_audit_id bigint generated always as identity primary key,
  actor_app_user_id uuid
    references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  subject_app_user_id uuid
    references mediasis.app_users(app_user_id)
    on update cascade on delete restrict,
  business_id uuid
    references mediasis.businesses(uid)
    on update cascade on delete restrict,
  action text not null,
  target_type text not null,
  target_id text,
  before_value jsonb,
  after_value jsonb,
  request_id text,
  source text not null default 'application',
  occurred_at timestamptz not null default now(),
  constraint authorization_audit_action_not_blank check (btrim(action) <> ''),
  constraint authorization_audit_target_not_blank check (btrim(target_type) <> ''),
  constraint authorization_audit_source_valid
    check (source in ('application', 'clerk_webhook', 'migration', 'manual'))
);

create index if not exists authorization_audit_business_time_idx
  on mediasis.authorization_audit_log(business_id, occurred_at desc);
create index if not exists authorization_audit_subject_time_idx
  on mediasis.authorization_audit_log(subject_app_user_id, occurred_at desc);
create index if not exists authorization_audit_request_idx
  on mediasis.authorization_audit_log(request_id)
  where request_id is not null;

create table if not exists mediasis.clerk_webhook_events (
  clerk_event_id text primary key,
  event_type text not null,
  status text not null default 'pending',
  payload jsonb not null,
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint clerk_webhook_event_id_not_blank check (btrim(clerk_event_id) <> ''),
  constraint clerk_webhook_event_type_not_blank check (btrim(event_type) <> ''),
  constraint clerk_webhook_event_status_valid
    check (status in ('pending', 'processing', 'processed', 'failed', 'ignored')),
  constraint clerk_webhook_attempts_nonnegative check (attempts >= 0),
  constraint clerk_webhook_processed_time_valid
    check (status <> 'processed' or processed_at is not null)
);

create index if not exists clerk_webhook_events_retry_idx
  on mediasis.clerk_webhook_events(status, received_at)
  where status in ('pending', 'failed');

alter table mediasis.authorization_audit_log enable row level security;
alter table mediasis.clerk_webhook_events enable row level security;

comment on table mediasis.authorization_audit_log is
  'Append-only history of authorization changes and sensitive access operations.';
comment on table mediasis.clerk_webhook_events is
  'Verified Clerk webhook events; primary key provides idempotency.';

-- Domain authorization records are removed logically. Direct DELETE statements
-- are rejected even for privileged application code. An explicitly reviewed
-- purge migration may temporarily remove a guard if required.
create or replace function mediasis.prevent_authorization_physical_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'Physical DELETE is disabled for %. Use status, revoked_at, or archived_at.',
    tg_table_name;
end;
$$;

do $$
declare
  guarded_table text;
  guarded_tables constant text[] := array[
    'app_users',
    'consumer_profiles',
    'business_permissions',
    'business_roles',
    'business_role_permissions',
    'business_memberships',
    'business_membership_roles',
    'business_membership_locations',
    'staff_permissions',
    'staff_roles',
    'staff_role_permissions',
    'staff_memberships',
    'staff_business_grants'
  ];
begin
  foreach guarded_table in array guarded_tables loop
    execute format(
      'drop trigger if exists %I on mediasis.%I',
      guarded_table || '_logical_delete_only',
      guarded_table
    );
    execute format(
      'create trigger %I before delete on mediasis.%I for each row execute function mediasis.prevent_authorization_physical_delete()',
      guarded_table || '_logical_delete_only',
      guarded_table
    );
  end loop;
end
$$;

-- Audit records are fully immutable after insertion.
create or replace function mediasis.prevent_authorization_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'authorization_audit_log is append-only';
end;
$$;

drop trigger if exists authorization_audit_log_append_only
  on mediasis.authorization_audit_log;
create trigger authorization_audit_log_append_only
before update or delete on mediasis.authorization_audit_log
for each row execute function mediasis.prevent_authorization_audit_mutation();

commit;
