import "server-only";

import { headers } from "next/headers";

import { dashboardAuthenticationMode, dashboardClerkEnabled } from "@/lib/clerk/config";

export async function clerkAuthenticationEnabledForRequest() {
  if (!dashboardClerkEnabled()) return false;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  return dashboardAuthenticationMode(host) !== "legacy";
}
