// Isolated PostgreSQL integration test. See daily_preparation_reset.md for usage.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, before, after } from 'node:test';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
let db;
const business = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const locA = '00000000-0000-4000-8000-000000000011';
const locB = '00000000-0000-4000-8000-000000000012';
const locOther = '00000000-0000-4000-8000-000000000013';
const pickup = '00000000-0000-4000-8000-000000000021';
const express = '00000000-0000-4000-8000-000000000022';
const allMethod = '00000000-0000-4000-8000-000000000023';
const otherMethod = '00000000-0000-4000-8000-000000000024';
const staff = '00000000-0000-4000-8000-000000000031';
const owner = '00000000-0000-4000-8000-000000000032';
const denied = '00000000-0000-4000-8000-000000000033';

async function scalar(sql, args = []) { return (await db.query(sql, args)).rows[0].value; }
async function settings(actor = null, id = business) {
  return scalar('select mediasis.get_dashboard_daily_preparation_reset_settings($1,$2) value', [id, actor]);
}
async function save({ actor = null, id = business, enabled = true, everywhere = true, locations = [], values = [] } = {}) {
  return scalar('select mediasis.save_dashboard_daily_preparation_reset_settings($1,$2,$3,$4,$5,$6) value',
    [id, actor, enabled, everywhere, locations, JSON.stringify(values)]);
}
async function run(time) { return scalar('select mediasis.run_daily_preparation_reset($1) value', [time]); }
async function offset(method = pickup, location = locA) {
  return scalar('select extract(epoch from pickup_ready_offset)/60 value from mediasis.delivery_method_business_pickup_offset_location where business_delivery_method_id=$1 and business_location_id=$2', [method, location]);
}
async function reset() {
  await db.exec(`truncate mediasis.daily_preparation_reset_config, mediasis.daily_preparation_reset_method_values,
    mediasis.daily_preparation_reset_location_state, mediasis.daily_preparation_reset_runs,
    mediasis.delivery_method_business_pickup_offset_location, mediasis.authorization_audit_log;
    update mediasis.business_market_settings set timezone='America/Costa_Rica';`);
}
async function dateState(date = '2026-09-07') {
  await db.query('update mediasis.daily_preparation_reset_location_state set last_processed_local_date=$1', [date]);
}
async function isolated(fn) { await db.exec('begin'); try { await reset(); await fn(); } finally { await db.exec('rollback'); } }

before(async () => {
  db = new PGlite();
  // Minimal existing schema. Authorization RPCs themselves are loaded verbatim
  // from the existing migration; only their lower-level permission lookup is a fixture.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema mediasis; grant usage on schema mediasis to anon, authenticated, service_role;
    create schema cron;
    create table cron.job(jobname text primary key, schedule text, command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job values($1,$2,$3) on conflict(jobname) do update set schedule=$2,command=$3 returning 1::bigint;
    $$;
    create table mediasis.businesses(uid uuid primary key);
    create table mediasis.business_location(business_location_id uuid primary key, business_uid uuid references mediasis.businesses(uid), short_name text);
    create table mediasis.business_market_settings(business_id uuid primary key references mediasis.businesses(uid), timezone text not null);
    create type mediasis.scope as enum ('all','specific');
    create table mediasis.delivery_methods_business(uid uuid primary key, business_id uuid references mediasis.businesses(uid), name text, scope mediasis.scope, visibility boolean default true, pickup_ready_offset interval default '5 minutes');
    create table mediasis.delivery_methods_business_location(delivery_methods_business_id uuid references mediasis.delivery_methods_business(uid), business_location_id uuid references mediasis.business_location(business_location_id), primary key(delivery_methods_business_id,business_location_id));
    create table mediasis.delivery_method_business_pickup_offset_location(business_delivery_method_id uuid references mediasis.delivery_methods_business(uid), business_location_id uuid references mediasis.business_location(business_location_id), pickup_ready_offset interval default '5 minutes', primary key(business_delivery_method_id,business_location_id));
    create table mediasis.business_memberships(business_membership_id uuid primary key, business_id uuid, app_user_id uuid, status text, revoked_at timestamptz, all_locations boolean, can_manage boolean);
    create table mediasis.business_membership_locations(business_membership_id uuid, business_location_id uuid, revoked_at timestamptz);
    create table mediasis.order_status_automation_config(business_id uuid, business_location_id uuid, enabled boolean);
    create table mediasis.authorization_audit_log(actor_app_user_id uuid, business_id uuid, action text, target_type text, target_id text, before_value jsonb, after_value jsonb);
    create function mediasis.team_actor_has_permission(uuid,uuid,text) returns boolean language sql as $$
      select exists(select 1 from mediasis.business_memberships where business_id=$1 and app_user_id=$2 and status='active' and revoked_at is null and can_manage);
    $$;
  `);
  const previous = await readFile(new URL('../migrations/dashboard_automatic_statuses_authorization.sql', import.meta.url), 'utf8');
  await db.exec(previous.slice(previous.indexOf('create or replace function mediasis.require_dashboard_automatic_statuses_access'),
    previous.indexOf('create or replace function mediasis.get_business_dashboard_automatic_statuses_permission_catalog')));
  const migration = await readFile(new URL('../migrations/dashboard_daily_preparation_reset.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(`
    insert into mediasis.businesses values('${business}'),('${other}');
    insert into mediasis.business_market_settings values('${business}','America/Costa_Rica'),('${other}','America/Costa_Rica');
    insert into mediasis.business_location values('${locA}','${business}','A'),('${locB}','${business}','B'),('${locOther}','${other}','Other');
    insert into mediasis.delivery_methods_business(uid,business_id,name,scope,visibility) values
      ('${pickup}','${business}','Pickup','specific',true), ('${express}','${business}','Express','specific',false),
      ('${allMethod}','${business}','All','all',true), ('${otherMethod}','${other}','Other','all',true);
    insert into mediasis.delivery_methods_business_location values('${pickup}','${locA}'),('${express}','${locA}'),('${express}','${locB}');
    insert into mediasis.business_memberships values('${staff}','${business}','${staff}','active',null,false,true),
      ('${owner}','${business}','${owner}','active',null,true,true),('${denied}','${business}','${denied}','active',null,true,false);
    insert into mediasis.business_membership_locations values('${staff}','${locA}',null);
  `);
});
after(async () => { await db?.close(); });

test('disabled by default, defaults to 10, original offset default and separate cron preserved', async () => isolated(async () => {
  const result = await settings();
  assert.equal(result.data.enabled, false);
  assert.ok(result.data.methods.every((m) => m.reset_minutes === 10 && m.uses_default));
  assert.deepEqual((await db.query("select schedule,command from cron.job where jobname='daily-preparation-reset-every-minute'")).rows,
    [{ schedule: '* * * * *', command: 'select mediasis.run_daily_preparation_reset();' }]);
  assert.equal(await scalar("select column_default value from information_schema.columns where table_schema='mediasis' and table_name='delivery_method_business_pickup_offset_location' and column_name='pickup_ready_offset'"), "'00:05:00'::interval");
  assert.equal((await run('2026-09-08T06:00:00Z')).affected_row_count, 0);
}));

test('enable waits for next local day; custom/shared/hidden methods, missing offsets and daytime edits', async () => isolated(async () => {
  assert.equal((await save({ values: [{ id: express, reset_minutes: 27 }] })).success, true);
  assert.equal(await scalar('select count(*)::int value from mediasis.delivery_method_business_pickup_offset_location'), 0);
  await dateState();
  assert.equal((await run('2026-09-08T05:59:59Z')).affected_row_count, 0);
  const result = await run('2026-09-08T06:00:00Z');
  assert.equal(result.location_count, 2);
  assert.equal(result.affected_row_count, 5);
  assert.equal(Number(await offset()), 10);
  assert.equal(Number(await offset(express, locA)), 27);
  assert.equal(Number(await offset(express, locB)), 27);
  await db.query("update mediasis.delivery_method_business_pickup_offset_location set pickup_ready_offset='85 minutes' where business_delivery_method_id=$1", [pickup]);
  assert.equal((await run('2026-09-08T15:00:00Z')).affected_row_count, 0);
  assert.equal(Number(await offset()), 85);
  assert.equal((await run('2026-09-09T06:00:00Z')).affected_row_count, 5);
  assert.equal(Number(await offset()), 10);
}));

test('selected locations, preserved state on edits/scope changes and re-enable tomorrow', async () => isolated(async () => {
  assert.equal((await save({ everywhere: false, locations: [locA] })).success, true);
  await dateState();
  assert.equal((await save({ everywhere: false, locations: [locA], values: [{ id: pickup, reset_minutes: 14 }] })).success, true);
  assert.equal(await scalar("select last_processed_local_date::text value from mediasis.daily_preparation_reset_location_state where business_location_id=$1", [locA]), '2026-09-07');
  const result = await run('2026-09-08T06:00:00Z');
  assert.equal(result.location_count, 1);
  assert.equal(result.affected_row_count, 3);
  assert.equal(await scalar('select count(*)::int value from mediasis.delivery_method_business_pickup_offset_location where business_location_id=$1', [locB]), 0);
  assert.equal((await save()).success, true);
  assert.equal(await scalar("select last_processed_local_date::text value from mediasis.daily_preparation_reset_location_state where business_location_id=$1", [locA]), '2026-09-08');
  assert.equal((await save({ enabled: false })).success, true);
  assert.equal((await settings()).data.methods.find((m) => m.id === pickup).reset_minutes, 14);
  assert.equal((await run('2026-09-15T06:00:00Z')).affected_row_count, 0);
  await dateState('2000-01-01');
  assert.equal((await save()).success, true);
  assert.equal(await scalar("select last_processed_local_date = (now() at time zone 'America/Costa_Rica')::date value from mediasis.daily_preparation_reset_location_state where business_location_id=$1", [locA]), true);
  assert.equal(Number(await offset()), 14);
}));

test('new methods inherit default and new globally enabled locations start the following day', async () => isolated(async () => {
  await save();
  const location = '00000000-0000-4000-8000-000000000099';
  const method = '00000000-0000-4000-8000-000000000098';
  await db.query('insert into mediasis.business_location values($1,$2,$3)', [location, business, 'New']);
  assert.equal(await scalar("select last_processed_local_date = (now() at time zone 'America/Costa_Rica')::date value from mediasis.daily_preparation_reset_location_state where business_location_id=$1", [location]), true);
  await db.query("insert into mediasis.delivery_methods_business(uid,business_id,name,scope) values($1,$2,'New','all')", [method, business]);
  await dateState();
  assert.equal((await run('2026-09-08T06:00:00Z')).location_count, 3);
  assert.equal(Number(await offset(method, location)), 10);
}));

test('timezone-specific dates, DST short/long days, and a single catch-up after missed days', async () => isolated(async () => {
  await save();
  await save({ id: other });
  await db.query("update mediasis.business_market_settings set timezone='Asia/Tokyo' where business_id=$1", [other]);
  await dateState();
  assert.equal((await run('2026-09-07T15:00:00Z')).location_count, 1);
  assert.equal((await run('2026-09-08T06:00:00Z')).location_count, 2);
  assert.equal((await run('2026-09-12T06:00:00Z')).location_count, 3);
  assert.equal((await run('2026-09-12T07:00:00Z')).location_count, 0);
  await db.query("update mediasis.business_market_settings set timezone='America/New_York' where business_id=$1", [business]);
  await dateState('2026-03-07');
  assert.equal((await run('2026-03-08T05:00:00Z')).affected_row_count, 6);
  assert.equal((await run('2026-03-09T03:59:59Z')).affected_row_count, 1); // Tokyo alone crossed midnight.
  assert.equal((await run('2026-03-09T04:00:00Z')).affected_row_count, 5);
  await dateState('2026-10-31');
  await run('2026-11-01T04:00:00Z');
  assert.equal((await run('2026-11-02T04:59:59Z')).affected_row_count, 1);
  assert.equal((await run('2026-11-02T05:00:00Z')).affected_row_count, 5);
}));

test('authorization: denied actor, foreign locations/methods, shared methods, allowed scoped changes', async () => isolated(async () => {
  assert.equal((await save({ actor: denied })).success, false);
  assert.equal((await save({ actor: staff })).success, false);
  assert.equal((await save({ everywhere: false, locations: [locOther] })).success, false);
  assert.equal((await save({ values: [{ id: otherMethod, reset_minutes: 12 }] })).success, false);
  for (const id of [express, allMethod]) {
    assert.equal((await save({ actor: staff, everywhere: false, locations: [locA], values: [{ id, reset_minutes: 12 }] })).success, false);
  }
  const scoped = await settings(staff);
  assert.deepEqual(scoped.data.locations.map((l) => l.business_location_id), [locA]);
  assert.equal(scoped.data.methods.find((m) => m.id === pickup).can_edit, true);
  assert.equal(scoped.data.methods.find((m) => m.id === express).can_edit, false);
  assert.equal((await save({ actor: owner, everywhere: false, locations: [locB] })).success, true);
  assert.equal((await save({ actor: staff, everywhere: false, locations: [locA], values: [{ id: pickup, reset_minutes: 12 }] })).success, true);
  assert.equal(await scalar('select count(*)::int value from mediasis.daily_preparation_reset_config where enabled'), 2);
  assert.equal((await save({ actor: staff, everywhere: false, locations: [locA], enabled: false })).success, true);
  assert.equal(await scalar('select enabled value from mediasis.daily_preparation_reset_config where business_location_id=$1', [locB]), true);
  assert.deepEqual((await settings(owner)).data.selected_location_ids, [locB]);
  await save();
  assert.equal((await save({ actor: staff, everywhere: false, locations: [locA] })).success, false);
}));

test('validation is atomic, default restoration and audit are persisted', async () => isolated(async () => {
  for (const minutes of [0, 181, 1.5, '10', true]) {
    assert.equal((await save({ values: [{ id: pickup, reset_minutes: minutes }] })).success, false);
  }
  assert.equal((await save({ everywhere: false })).success, false);
  assert.equal((await save({ values: [{ id: pickup, reset_minutes: 20 }, { id: pickup, reset_minutes: 30 }] })).success, false);
  assert.equal((await save({ values: [{ id: pickup, reset_minutes: 20 }, { id: otherMethod, reset_minutes: 30 }] })).success, false);
  assert.equal((await settings()).data.enabled, false);
  assert.equal((await settings()).data.methods.find((m) => m.id === pickup).reset_minutes, 10);
  assert.equal((await save({ values: [{ id: pickup, reset_minutes: 180 }] })).success, true);
  assert.equal((await save({ values: [{ id: pickup, reset_minutes: null }] })).success, true);
  assert.equal((await settings()).data.methods.find((m) => m.id === pickup).uses_default, true);
  assert.equal(await scalar('select count(*)::int value from mediasis.authorization_audit_log'), 2);
}));

test('missing/invalid timezone fails safely and does not prevent other businesses', async () => isolated(async () => {
  await save(); await save({ id: other }); await dateState();
  await db.query("update mediasis.business_market_settings set timezone='Invalid/Zone' where business_id=$1", [business]);
  assert.equal((await save()).success, false);
  const result = await run('2026-09-08T06:00:00Z');
  assert.equal(result.failed_business_count, 1);
  assert.equal(result.affected_row_count, 1);
  assert.equal(await scalar('select count(*)::int value from mediasis.delivery_method_business_pickup_offset_location where business_location_id=$1', [locA]), 0);
  await run('2026-09-08T06:01:00Z');
  assert.equal(await scalar("select attempts value from mediasis.daily_preparation_reset_runs where status='failed'"), 2);
  await db.query('delete from mediasis.business_market_settings where business_id=$1', [business]);
  assert.equal((await run('2026-09-08T06:02:00Z')).failed_business_count, 1);
  await db.query("insert into mediasis.business_market_settings values($1,'America/Costa_Rica')", [business]);
  assert.equal((await run('2026-09-08T06:03:00Z')).affected_row_count, 5);
}));

test('failed offset write rolls back all offsets and state for business, then retries', async () => isolated(async () => {
  await save(); await save({ id: other }); await dateState();
  await db.exec(`create function mediasis.test_fail_offset() returns trigger language plpgsql as $$ begin
    if new.business_delivery_method_id = '${express}' then raise exception 'Test failure'; end if; return new; end $$;
    create trigger test_fail_offset before insert or update on mediasis.delivery_method_business_pickup_offset_location for each row execute function mediasis.test_fail_offset();`);
  const result = await run('2026-09-08T06:00:00Z');
  assert.equal(result.failed_business_count, 1);
  assert.equal(result.affected_row_count, 1);
  assert.equal(await scalar("select last_processed_local_date::text value from mediasis.daily_preparation_reset_location_state where business_location_id=$1", [locA]), '2026-09-07');
  assert.equal(await scalar('select count(*)::int value from mediasis.delivery_method_business_pickup_offset_location where business_location_id=$1', [locA]), 0);
  await db.exec('drop trigger test_fail_offset on mediasis.delivery_method_business_pickup_offset_location');
  assert.equal((await run('2026-09-08T06:01:00Z')).affected_row_count, 5);
}));

test('client roles cannot execute reset RPCs or read/write reset configuration', async () => isolated(async () => {
  for (const role of ['anon', 'authenticated']) {
    assert.equal(await scalar("select has_function_privilege($1, 'mediasis.run_daily_preparation_reset(timestamptz)', 'EXECUTE') value", [role]), false);
    assert.equal(await scalar("select has_function_privilege($1, 'mediasis.get_dashboard_daily_preparation_reset_settings(uuid,uuid)', 'EXECUTE') value", [role]), false);
    assert.equal(await scalar("select has_function_privilege($1, 'mediasis.save_dashboard_daily_preparation_reset_settings(uuid,uuid,boolean,boolean,uuid[],jsonb)', 'EXECUTE') value", [role]), false);
    assert.equal(await scalar("select has_table_privilege($1, 'mediasis.daily_preparation_reset_config', 'INSERT,UPDATE,DELETE,SELECT') value", [role]), false);
  }
  assert.equal(await scalar("select has_function_privilege('service_role', 'mediasis.run_daily_preparation_reset(timestamptz)', 'EXECUTE') value"), true);
  assert.equal(await scalar("select has_table_privilege('service_role', 'mediasis.daily_preparation_reset_config', 'INSERT,UPDATE,DELETE') value"), false);
  await db.exec('set local role service_role');
  assert.equal((await save({ actor: owner })).success, true);
  assert.equal((await settings(owner)).data.enabled, true);
  await db.exec('reset role');
}));

test('revoked memberships/assignments cannot manage resets; order status configuration is unchanged', async () => isolated(async () => {
  await db.query('insert into mediasis.order_status_automation_config values($1,null,true)', [business]);
  await db.query('update mediasis.business_membership_locations set revoked_at=now() where business_membership_id=$1', [staff]);
  assert.equal((await save({ actor: staff, everywhere: false, locations: [locA] })).success, false);
  assert.deepEqual((await settings(staff)).data.methods, []);
  await db.query('update mediasis.business_memberships set revoked_at=now() where app_user_id=$1', [owner]);
  assert.equal((await save({ actor: owner })).success, false);
  await save(); await dateState(); await run('2026-09-08T06:00:00Z');
  assert.equal(await scalar('select enabled value from mediasis.order_status_automation_config where business_id=$1', [business]), true);
}));
