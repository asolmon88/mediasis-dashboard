import type { BusinessLocations } from "@/lib/types/dashboardTypes";

export type DashboardBusiness = {
  businessId: string;
  name: string;
  avatarUrl: string | null;
  clerkOrganizationId: string | null;
};

export type BusinessMarket = {
  countryCode: string;
  countryName: string;
  timezone: string;
  currencyCode: string;
  locale: string;
  phoneCountryCode: string;
  capabilities: string[];
};

export type DashboardBusinessState = {
  subscription_status: string | null;
  subscription_owner_id: string | null;
  amount_minor: number | null;
  currency_code: string | null;
  grace_ends_at: string | null;
  cancellation_requested_at: string | null;
  cancel_at: string | null;
  trial_status: string | null;
  trial_ends_at: string | null;
  account_owner_id: string | null;
  plan_key: string | null;
  has_onvo_card: boolean;
  onboarding_complete: boolean;
  renewal_pending: boolean;
  renewal_failure_category: string | null;
  cancellation_fee: { amount_minor: number; currency_code: string } | null;
};

export type DashboardAuthorizationContext = {
  mode: "legacy" | "clerk" | "staff";
  appUserId: string | null;
  user: {
    name: string;
    email: string;
    avatarUrl: string | null;
  };
  activeBusinessId: string | null;
  pendingOnboardingBusinessId: string | null;
  activeClerkOrganizationId: string | null;
  businesses: DashboardBusiness[];
  permissions: string[];
  allLocations: boolean;
  locations: BusinessLocations;
  reservationLocationIds: string[];
  canCreateBusiness: boolean;
  market: BusinessMarket | null;
  businessState: DashboardBusinessState | null;
};

export const isClerkDashboardMode = (context: DashboardAuthorizationContext) =>
  context.mode === "clerk" || context.mode === "staff";

export const hasDashboardPermission = (
  context: DashboardAuthorizationContext,
  permission: string
) => context.permissions.includes("*") || context.permissions.includes(permission);
