# Padfy Production Clerk pilot

This pilot is hardcoded to Padfy (`7e15147b-89b0-4abe-8a29-5bf7a9acb525`) and `lookcr506@gmail.com`. It cannot migrate another business.

1. Review and apply `supabase/migrations/padfy_clerk_pilot.sql`.
2. Confirm `.env` contains the production Supabase configuration and Production Clerk `sk_live_` secret.
3. Run the read-only check:

```bash
node --env-file=.env docs/scripts/migrate-padfy-clerk-pilot.mjs --dry-run
```

4. Create the final Production Clerk identity, Organization, and Mediasis membership:

```bash
node --env-file=.env docs/scripts/migrate-padfy-clerk-pilot.mjs --confirm-production
```

The command is idempotent and never prints the password digest. Padfy can then sign in through the existing dashboard Clerk sign-in page with its current password.

The pilot does not require Clerk Organization slugs. It identifies Padfy retries through private Organization metadata.

This pilot does not remove or modify dashboard registration, legacy login, consumer authentication, or any other business account.
