import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { listApplePayDomains, syncApplePayDomain } from "@/lib/onvo/apple-pay-domains";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const admin = createAdminClient();
  const { count, error: countError } = await admin.schema("mediasis").from("storefront_domains")
    .select("storefront_domain_id", { count: "exact", head: true }).eq("verification_status", "active").is("disconnected_at", null);
  if (countError) return NextResponse.json({ error: "Could not count domains" }, { status: 500 });
  const pages = Math.max(1, Math.ceil((count ?? 0) / 40));
  const page = Math.floor(Date.now() / 300_000) % pages;
  const { data: domains, error } = await admin.schema("mediasis").from("storefront_domains")
    .select("business_id").eq("verification_status", "active").is("disconnected_at", null)
    .order("storefront_domain_id").range(page * 40, page * 40 + 39);
  if (error) return NextResponse.json({ error: "Could not list domains" }, { status: 500 });
  const businessIds = [...new Set((domains ?? []).map((domain) => domain.business_id))];
  let registered = 0;
  let attempted = 0;
  for (const businessId of businessIds) {
    try {
      const statuses = await listApplePayDomains(admin, businessId);
      for (const domain of statuses.filter((item) => item.state === "not_registered")) {
        if (attempted >= 2) break;
        attempted++;
        try {
          await syncApplePayDomain(admin, businessId, domain.storefrontDomainId, domain.hostname, "register");
          registered++;
        } catch (cause) {
          console.warn("[apple-pay-domains] registration_deferred", { businessId, hostname: domain.hostname, message: cause instanceof Error ? cause.message : String(cause) });
        }
      }
    } catch (cause) {
      console.error("[apple-pay-domains] business_failed", { businessId, message: cause instanceof Error ? cause.message : String(cause) });
    }
    if (attempted >= 2) break;
  }
  return NextResponse.json({ examinedBusinesses: businessIds.length, registered });
}
