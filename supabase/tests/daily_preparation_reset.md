# Daily preparation reset verification and rollout

The migration is `supabase/migrations/dashboard_daily_preparation_reset.sql`.
It depends on the existing automatic-status authorization and business-market
configuration migrations. Apply it once with Supabase MCP `apply_migration`
before deploying the dashboard. It does not opt in any businesses and does not
change the existing offset column default or automatic order-status job.

## Isolated PostgreSQL tests

The tests execute the actual migration in PGlite (PostgreSQL), using a minimal
fixture for existing tables, the existing automatic-status authorization RPCs,
and a stub for cron registration. They never connect to the live database.

Install the test runtime outside the application, then run from the dashboard:

```sh
npm install --prefix /tmp/mediasis-preparation-reset-tests --no-package-lock --no-audit --no-fund @electric-sql/pglite@0.5.8
PGLITE_MODULE=/tmp/mediasis-preparation-reset-tests/node_modules/@electric-sql/pglite/dist/index.js node --test supabase/tests/daily_preparation_reset.test.mjs
node --test supabase/tests/daily_preparation_reset_validation.test.mjs
```

The validation test requires Node 22.18+ for native TypeScript type stripping.
PGlite tests cover configuration defaults, per-method values, hidden/shared
methods, scopes, missing offset creation, new locations/methods, local midnight,
DST, catch-up, daytime edits, disable/re-enable, atomic validation, audit,
permissions, missing/invalid timezones, and business-isolated failure/retry.
PGlite uses one database connection; cross-session lock contention and the real
pg_cron scheduler still require a staging Supabase check after migration.

## Supabase MCP verification after applying

```sql
select jobname, schedule, command, active
from cron.job
where jobname in ('daily-preparation-reset-every-minute', 'auto-order-status-every-60-seconds');

select count(*) as opted_in_businesses
from mediasis.daily_preparation_reset_config where enabled;

select mediasis.run_daily_preparation_reset(); -- Initial no-op; nobody opted in.

select * from mediasis.daily_preparation_reset_runs order by updated_at desc limit 20;

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'daily-preparation-reset-every-minute')
order by start_time desc limit 10;
```

On staging, open App de dashboard → Reinicio diario de preparación
(`/admin/dashboard-app/daily-preparation-reset`). Enable a test business with all locations and then
with selected locations. Confirm the returned timezone, next-day activation,
default/custom settings after reload, and that saving reset settings does not
change the separate Estados automáticos page. Verify location-limited staff cannot edit shared values outside
their access and that global activation is read-only to those staff.

For cross-session verification, hold the transaction advisory lock
`hashtextextended('daily-preparation-reset:' || business_id::text, 0)` in one
staging SQL session while saving configuration/running the reset in another.
Confirm the second session waits and rechecks configuration after the first
commits. Also launch two reset calls concurrently: only one may process the
same business/location/local date. Do not simulate future timestamps against
production businesses: the optional runner timestamp exists for isolated tests.

An outcome row is aggregated by business, date, and status. `failed` rows retain
the latest error and attempt count, while `completed` rows count reset locations
and affected offsets. An invalid timezone uses a UTC date for its error record
only. Correct the market settings to allow the next cron tick to retry. Failures
are caught per business, so inspect `failed` outcome rows even when pg_cron's
SQL execution is marked successful.

To pause the feature operationally without losing configuration:

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'daily-preparation-reset-every-minute'),
  active := false
);
```

Reactivating the job catches up once on the current local date. Disabling a
business through the UI preserves its custom method values; re-enabling that
business waits until the next local day.
