import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { cache } from "react";

import { clerkAuthenticationEnabledForRequest } from "@/lib/clerk/server-config";
import type { DashboardAuthorizationContext, DashboardBusinessState } from "@/lib/dashboard/auth-types";
import {
  reconcileAcceptedBusinessInvitation,
  reconcileAcceptedBusinessInvitationForUser,
} from "@/lib/dashboard/reconcile-business-invitation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ContextRpc = {
  success?: boolean;
  mode?: "legacy" | "clerk" | "staff" | "none";
  app_user_id?: string | null;
  active_business_id?: string;
  all_locations?: boolean;
  businesses?: Array<{
    business_id: string;
    name: string;
    avatar_url?: string | null;
    clerk_organization_id?: string | null;
  }>;
  permissions?: string[];
  locations?: DashboardAuthorizationContext["locations"];
  bootstrap_business_state?: DashboardBusinessState | null;
  bootstrap_market?: { country_code: string; country_name: string; timezone: string; currency_code: string; locale: string; phone_country_code: string; capabilities?: string[] } | null;
  bootstrap_reservation_location_ids?: string[];
  bootstrap_can_create_business?: boolean;
};

export const synchronizeClerkIdentity = cache(async function synchronizeClerkIdentity(userId: string) {
  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const primaryEmail = user.emailAddresses.find(
    (email) => email.id === user.primaryEmailAddressId
  )?.emailAddress;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || primaryEmail || "Usuario Mediasis";
  const admin = createAdminClient();
  const normalizedEmail = primaryEmail?.toLowerCase() ?? null;
  const { error } = await admin.schema("mediasis").from("app_users").upsert(
    {
      clerk_user_id: user.id,
      primary_email: normalizedEmail,
      display_name: displayName,
      avatar_url: user.imageUrl || null,
      status: "active",
      deleted_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "clerk_user_id" }
  );
  if (error) {
    // AdminLayout and AdminPage can synchronize a brand-new Clerk identity in
    // parallel. One insert wins; the other may hit the partial unique index on
    // normalized email before its clerk_user_id conflict is visible. Accept
    // that race only when the committed row belongs to this exact Clerk user.
    if (error.code === "23505" && normalizedEmail) {
      const { data: existingIdentity, error: lookupError } = await admin
        .schema("mediasis")
        .from("app_users")
        .select("clerk_user_id")
        .ilike("primary_email", normalizedEmail)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle();

      if (lookupError || existingIdentity?.clerk_user_id !== user.id) {
        throw new Error(`Unable to synchronize dashboard identity: ${error.message}`);
      }
    } else {
      throw new Error(`Unable to synchronize dashboard identity: ${error.message}`);
    }
  }

  if (normalizedEmail === "alejandrog@mediasis.cr" || normalizedEmail === "ariel.solis@mediasis.cr") {
    const { data: provisioned, error: provisioningError } = await admin
      .schema("mediasis")
      .rpc("provision_initial_mediasis_staff", {
        p_clerk_user_id: user.id,
        p_email: normalizedEmail,
      });
    if (provisioningError || !provisioned?.success) {
      throw new Error(`Unable to provision initial Mediasis staff access: ${provisioningError?.message ?? "unknown error"}`);
    }
  }
  return { user, primaryEmail, displayName };
});

export const getDashboardAuthorizationContext = cache(async function getDashboardAuthorizationContext(): Promise<DashboardAuthorizationContext | null> {
  const started = Date.now();
  const supabase = await createClient();
  let requestedBusinessId: string | null = null;
  let clerkPresentation:
    | { name: string; email: string; avatarUrl: string | null; organizationId: string | null }
    | null = null;
  let staffMode = false;
  let authenticatedClerkUserId: string | null = null;
  let authenticatedClerkEmail: string | null = null;

  if (await clerkAuthenticationEnabledForRequest()) {
    const session = await auth();
    if (session.userId) {
      authenticatedClerkUserId = session.userId;
      const synchronized = await synchronizeClerkIdentity(session.userId);
      authenticatedClerkEmail = synchronized.primaryEmail?.toLowerCase() ?? null;
      const admin = createAdminClient();
      const { data: synchronizedIdentity } = await admin
        .schema("mediasis")
        .from("app_users")
        .select("app_user_id,dashboard_disabled_at")
        .eq("clerk_user_id", session.userId)
        .eq("status", "active")
        .is("deleted_at", null)
        .maybeSingle();
      if (synchronizedIdentity?.dashboard_disabled_at) return null;
      if (synchronizedIdentity?.app_user_id) {
        const { data: isStaff } = await admin
          .schema("mediasis")
          .rpc("is_mediasis_staff_actor", { p_app_user_id: synchronizedIdentity.app_user_id });
        staffMode = isStaff === true;
      }

      if (staffMode) {
        const selected = (await cookies()).get("mediasis_staff_business_id")?.value ?? null;
        requestedBusinessId = selected && /^[0-9a-f-]{36}$/i.test(selected) ? selected : null;
      } else if (session.orgId) {
        const { data } = await admin
          .schema("mediasis")
          .from("businesses")
          .select("uid")
          .eq("clerk_organization_id", session.orgId)
          .maybeSingle();
        requestedBusinessId = data?.uid ?? null;
      }
      clerkPresentation = {
        name: synchronized.displayName,
        email: synchronized.primaryEmail ?? "",
        avatarUrl: synchronized.user.imageUrl || null,
        organizationId: session.orgId ?? null,
      };
    }
  }

  if (
    !staffMode
    && authenticatedClerkUserId
    && authenticatedClerkEmail
    && !requestedBusinessId
  ) {
    const reconciliation = await reconcileAcceptedBusinessInvitationForUser({
      clerkUserId: authenticatedClerkUserId,
      email: authenticatedClerkEmail,
    });
    if (reconciliation.reconciled) {
      requestedBusinessId = reconciliation.businessId;
      if (clerkPresentation) {
        clerkPresentation.organizationId = reconciliation.organizationId;
      }
    }
  }

  const bootstrap = (businessId: string | null) => supabase.schema("mediasis").rpc(
    "get_dashboard_bootstrap_context",
    { p_requested_business_id: businessId, p_staff_mode: staffMode },
  );
  const rpcStarted = Date.now();
  let { data, error } = await bootstrap(requestedBusinessId);

  // A staff member can select any active business. If that business was removed
  // (for example after resetting a local database), its browser cookie must not
  // turn an otherwise valid Mediasis staff session into an unauthorized session.
  // Retry without the stale selection; the RPC still performs the staff-role
  // check and returns no active business until one is selected or created.
  if (staffMode && requestedBusinessId && !error && data?.success !== true) {
    ({ data, error } = await bootstrap(null));
  }
  // A Clerk organization can remain selected after its business is closed, or
  // the first membership returned by the RPC can belong to a disabled app.
  // Try only this user's non-closed memberships; a billing-paused business has
  // app_active=false but must remain selectable for its recovery panel. The RPC still
  // performs the authoritative membership and permission checks for each one.
  if (!staffMode && authenticatedClerkUserId && !error && (data?.success !== true || !data?.active_business_id)) {
    const admin = createAdminClient();
    const { data: identity, error: identityError } = await admin.schema("mediasis")
      .from("app_users").select("app_user_id").eq("clerk_user_id", authenticatedClerkUserId)
      .eq("status", "active").is("deleted_at", null).maybeSingle();
    if (!identityError && identity?.app_user_id) {
      const { data: memberships, error: membershipError } = await admin.schema("mediasis")
        .from("business_memberships")
        .select("business_id,businesses!inner(active,clerk_organization_id)")
        .eq("app_user_id", identity.app_user_id).eq("status", "active").is("revoked_at", null)
        .eq("businesses.active", true);
      if (!membershipError) {
        for (const membership of memberships ?? []) {
          const candidate = await bootstrap(membership.business_id);
          if (!candidate.error && candidate.data?.success && candidate.data.active_business_id === membership.business_id) {
            data = candidate.data;
            error = null;
            requestedBusinessId = membership.business_id;
            const business = Array.isArray(membership.businesses) ? membership.businesses[0] : membership.businesses;
            if (clerkPresentation) clerkPresentation.organizationId = business?.clerk_organization_id ?? null;
            break;
          }
        }
      }
    }
  }
  if (
    !staffMode
    && authenticatedClerkUserId
    && authenticatedClerkEmail
    && requestedBusinessId
    && clerkPresentation?.organizationId
    && !error
    && data?.success
    && !data.active_business_id
  ) {
    const reconciliation = await reconcileAcceptedBusinessInvitation({
      businessId: requestedBusinessId,
      organizationId: clerkPresentation.organizationId,
      email: authenticatedClerkEmail,
      clerkUserId: authenticatedClerkUserId,
    });
    if (reconciliation.reconciled) {
      const refreshed = await bootstrap(requestedBusinessId);
      data = refreshed.data;
      error = refreshed.error;
    }
  }
  if (error) {
    console.error("[dashboard-bootstrap] rpc_failed", { code: error.code, message: error.message });
    throw new Error("No se pudo cargar el contexto del dashboard.");
  }
  if (!data?.success) return null;
  console.info("[dashboard-bootstrap] timings_ms", { total: Date.now() - started, rpc: Date.now() - rpcStarted });
  const rpc = data as ContextRpc;
  // A Clerk session by itself is not a dashboard role. Consumer-only accounts
  // must have a business membership (or staff access) before entering /admin.
  if (rpc.mode !== "staff" && (rpc.businesses?.length ?? 0) === 0) return null;

  const canCreateBusiness = rpc.mode !== "legacy" && rpc.bootstrap_can_create_business === true;

  // The authorization RPC selects an actual membership even when Clerk has
  // not propagated an organization selection. Keep that verified business
  // (including for owners with multiple businesses) and its location context.
  const selectedBusiness = (rpc.businesses ?? []).find((business) => business.business_id === rpc.active_business_id);
  const clerkWithoutMappedActiveOrganization = Boolean(
    clerkPresentation && !staffMode && !requestedBusinessId && !selectedBusiness,
  );
  if (selectedBusiness && clerkPresentation && !requestedBusinessId) {
    clerkPresentation.organizationId = selectedBusiness.clerk_organization_id ?? null;
  }

  const authorizedLocations = clerkWithoutMappedActiveOrganization ? [] : rpc.locations ?? [];
  const resolvedActiveBusinessId = clerkWithoutMappedActiveOrganization
    ? null
    : rpc.active_business_id ?? null;
  let pendingOnboardingBusinessId: string | null = null;
  if (resolvedActiveBusinessId && !staffMode && rpc.bootstrap_business_state?.onboarding_complete === false)
    pendingOnboardingBusinessId = resolvedActiveBusinessId;
  if (staffMode && resolvedActiveBusinessId && clerkPresentation) {
    const selectedBusiness = (rpc.businesses ?? []).find(
      (business) => business.business_id === resolvedActiveBusinessId,
    );
    clerkPresentation.organizationId = selectedBusiness?.clerk_organization_id ?? null;
  }
  const reservationLocationIds = rpc.bootstrap_reservation_location_ids ?? [];
  let market: DashboardAuthorizationContext["market"] = null;
  if (resolvedActiveBusinessId && !pendingOnboardingBusinessId) {
    const marketData = rpc.bootstrap_market;
    if (marketData) {
      market = {
        countryCode: marketData.country_code,
        countryName: marketData.country_name,
        timezone: marketData.timezone,
        currencyCode: marketData.currency_code,
        locale: marketData.locale,
        phoneCountryCode: marketData.phone_country_code,
        capabilities: marketData.capabilities ?? [],
      };
    }
  }

  let legacyUser = { name: "Negocio Mediasis", email: "", avatarUrl: null as string | null };
  if (rpc.mode === "legacy") {
    const { data: authData } = await supabase.auth.getUser();
    legacyUser = {
      name: authData.user?.user_metadata?.full_name ?? authData.user?.email ?? "Negocio Mediasis",
      email: authData.user?.email ?? "",
      avatarUrl: authData.user?.user_metadata?.avatar_url ?? null,
    };
  }

  // The sidebar still needs the selected business and the list of businesses,
  // but a locked business must not retain its normal action permissions when
  // an old client sends a server action directly.
  let billingLocked = false;
  if (rpc.mode === "clerk" && resolvedActiveBusinessId && !pendingOnboardingBusinessId) {
    const state = rpc.bootstrap_business_state;
    billingLocked = state?.subscription_status === "suspended"
      || Boolean(state?.cancellation_requested_at && state.cancel_at
        && new Date(state.cancel_at).getTime() <= Date.now())
      || state?.trial_status === "expired" || state?.trial_status === "cancelled"
      || Boolean(state?.trial_status === "active" && state.trial_ends_at && new Date(state.trial_ends_at).getTime() <= Date.now());
  }

  return {
    mode: rpc.mode === "legacy" ? "legacy" : rpc.mode === "staff" ? "staff" : "clerk",
    appUserId: rpc.app_user_id ?? null,
    user: clerkPresentation
      ? { name: clerkPresentation.name, email: clerkPresentation.email, avatarUrl: clerkPresentation.avatarUrl }
      : legacyUser,
    activeBusinessId: pendingOnboardingBusinessId ? null : resolvedActiveBusinessId,
    pendingOnboardingBusinessId,
    activeClerkOrganizationId: clerkPresentation?.organizationId ?? null,
    businesses: (rpc.businesses ?? []).map((business) => ({
      businessId: business.business_id,
      name: business.name,
      avatarUrl: business.avatar_url ?? null,
      clerkOrganizationId: business.clerk_organization_id ?? null,
    })),
    permissions: clerkWithoutMappedActiveOrganization || pendingOnboardingBusinessId || billingLocked ? [] : rpc.permissions ?? [],
    allLocations: clerkWithoutMappedActiveOrganization || Boolean(pendingOnboardingBusinessId) || billingLocked ? false : rpc.all_locations ?? false,
    locations: pendingOnboardingBusinessId || billingLocked ? [] : authorizedLocations,
    reservationLocationIds: billingLocked ? [] : reservationLocationIds,
    canCreateBusiness,
    market,
    businessState: rpc.bootstrap_business_state ?? null,
  };
});
