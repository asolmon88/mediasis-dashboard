# Consumer authentication rollout

The application code and SQL drafts are intentionally deployable in stages. Guest
checkout must remain available throughout the rollout.

## 1. Clerk

1. Enable phone number + verification code for sign-in and sign-up.
2. Configure `www.mediasis.cr` as the primary domain.
3. Add one pharmacy custom domain as the first satellite.
4. Configure the primary sign-in and sign-up URLs shown in the order app's
   `.env.example`.
5. Add a webhook pointing to `/api/webhooks/clerk` and subscribe to
   `user.created`, `user.updated`, and `user.deleted`.
6. Copy the webhook signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`.
7. Keep satellite automatic synchronization disabled for the pilot.

Supabase must have Clerk configured as a third-party auth provider. The issuer
must exactly match the Clerk instance domain. The browser/server Supabase client
then sends the Clerk session token; PostgreSQL resolves its `sub` using
`mediasis.current_app_user_id()`.

## 2. Database order

1. Review and apply `supabase/migrations/consumer_ownership_and_account_claims.sql`.
2. Review and apply `supabase/migrations/consumer_profile_and_order_api.sql`.
3. Run `supabase/migrations/consumer_foundation_verification.sql`.
4. Deploy the order application and validate both guest and authenticated flows.
5. Do **not** apply `supabase/migrations/consumer_rls_cutover.sql` yet.

Migration 010 deliberately requires
`SET LOCAL mediasis.consumer_rls_cutover_approved = 'yes'`. Apply it only after all
checkout/payment/tracking paths have been moved behind reviewed restricted
server operations and the acceptance suite passes.

## 3. Pilot acceptance

- Guest browsing, cart, checkout OTP, payment retry, receipt, and tracking work.
- Clerk phone OTP creates a session on the primary domain.
- The session is recognized on the pilot satellite.
- A signed-in order receives `app_user_id`.
- A guest can claim only the just-completed order after checkout phone verification.
- A claim expires after 15 minutes and cannot be used twice.
- `/account` returns only the current consumer's profile and sanitized orders.
- Clerk webhook replay returns success without processing the event twice.

## Operational notes

- Service-role credentials are server-only.
- Checkout email remains Mediasis contact data and is not sent to Clerk.
- Consumer and authorization records are logically deleted.
- Account claims and authorization audit records cannot be physically deleted.
- Cashback and payment methods are not part of this rollout.
