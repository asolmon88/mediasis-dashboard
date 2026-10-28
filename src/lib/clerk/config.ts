/**
 * Client-side Clerk components only require the publishable key. Keep this
 * check aligned with the public feature flag used to expose Clerk links and
 * routes; otherwise a <SignIn /> can render without a surrounding provider.
 */
export const dashboardClerkClientEnabled = () =>
  process.env.NEXT_PUBLIC_DASHBOARD_CLERK_AUTH_ENABLED === "true" &&
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * Middleware and server authorization additionally require the secret key.
 * This is intentionally stricter than the provider check.
 */
export const dashboardClerkEnabled = () =>
  process.env.DASHBOARD_CLERK_AUTH_ENABLED === "true" &&
  dashboardClerkClientEnabled() &&
  Boolean(process.env.CLERK_SECRET_KEY);

export type DashboardAuthenticationMode = "legacy" | "clerk" | "hybrid";

export function normalizeDashboardHost(host: string | null | undefined) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

/**
 * Production authentication is intentionally split by hostname during the
 * compatibility period. The .com dashboard remains on Supabase Auth while
 * Mediasis-controlled .app hosts use Clerk. Unknown/local hosts retain the
 * existing hybrid behavior so ordinary localhost development is not broken.
 */
export function dashboardAuthenticationMode(host: string | null | undefined): DashboardAuthenticationMode {
  const normalized = normalizeDashboardHost(host);
  if (normalized === "dashboard.eatsycr.com") return "legacy";
  if (normalized === "dashboard.mediasis.cr" || normalized.endsWith(".mediasis.cr")) return "clerk";
  return "hybrid";
}
