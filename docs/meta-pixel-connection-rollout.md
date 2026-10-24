# Meta Pixel pilot and token lookup cutover

## Pilot setup

Configure `META_PARTNER_BUSINESS_ID` with the Business Portfolio ID that owns
`META_APP_ID`, and `META_PARTNER_SYSTEM_USER_TOKEN` with an admin system-user
token for that same portfolio. Both values are configured once for Mediasis. The
dashboard verifies the app's owner through Meta before creating a credential.
An ad account ID is not a Business Portfolio ID.

The merchant authorization requests `business_management` and
`ads_management`, plus Meta's required dependency permissions
`pages_show_list` and `pages_read_engagement`. Mediasis does not read, display, or
store Facebook Page content or engagement data; the Page permissions are
requested only because Meta requires them for the two primary permissions.
Keep all four permissions aligned between the OAuth request, App Review
submission, reviewer instructions, and screencast.

Foody (`787c460a-8896-4ea6-a1c3-509f93faa8f5`) is the only business allowed
to connect during the pilot. The dashboard discovers the owner of Pixel
`1465410088761576` from the Meta authorization. A Pixel owned by the Mediasis
portfolio uses an Mediasis system user. A Pixel owned by another portfolio uses
Meta's Business On Behalf Of flow. No merchant-specific environment variable
is needed.

After connecting Foody, trigger an existing consented event on
`test.mediasis.cr` and confirm its receipt in Meta Events Manager. Also test a
revoked credential, reconnect, and an unauthorized Pixel. A failed reconnect
must leave the previous Pixel ID and token unchanged.

## Final token lookup cutover — do not apply during the pilot

The current `mediasis.get_business_meta_token_by_domain(text)` function grants
execution to `anon` and `authenticated`, so those roles can retrieve tokens.
The order app currently calls it through its session/public Supabase client.
Production merchants depend on this path.

1. Verify Foody's dashboard-saved credential sends an event and record the
   existing production merchants that have `meta_token_orders` configured.
2. Change only `loadMetaAccessToken` in the order app's
   `src/app/api/meta/route.ts` to call the same RPC through `createAdminClient()`.
   Keep Pixel ID lookup and event payload, consent, and deduplication unchanged.
   Deploy the order app first and confirm events for Foody and existing merchants.
3. In a separate database migration, run:

   ```sql
   begin;
   revoke all on function mediasis.get_business_meta_token_by_domain(text)
     from public, anon, authenticated;
   grant execute on function mediasis.get_business_meta_token_by_domain(text)
     to service_role;
   commit;
   ```

   Confirm `anon` and `authenticated` cannot execute the function, while the
   order app still sends events with the server credential.
4. Roll back the database grant only if the server lookup fails during cutover:

   ```sql
   grant execute on function mediasis.get_business_meta_token_by_domain(text)
     to anon, authenticated;
   ```

   Then restore the previous order-app deployment if needed. Keep the time
   between rollback and repair short because public access exposes tokens.

After Meta review approval and the production checks above, remove the Foody
sidebar and endpoint gate in a separate rollout.
