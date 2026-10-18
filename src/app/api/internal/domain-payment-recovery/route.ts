import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileDomainPurchase } from "@/lib/domains/reconcile-domain-purchase";
import { refreshPurchasedDomain, syncPurchasedPrimaryDomain } from "@/lib/domains/refresh-purchased-domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.schema("mediasis").from("storefront_domain_purchase_attempts")
    .select("tilopay_order_number")
    .or(`reconciliation_next_at.lte.${new Date().toISOString()},receipt_retry_at.lte.${new Date().toISOString()}`)
    .order("created_at", { ascending: true }).limit(3);
  if (error) return NextResponse.json({ error: "Recovery query failed" }, { status: 500 });
  await Promise.allSettled((data ?? []).map(async (attempt) => {
    try { await reconcileDomainPurchase(attempt.tilopay_order_number); }
    catch (failure) { console.error("Domain payment recovery failed", { reference: attempt.tilopay_order_number, failure }); }
  }));
  const { data: pendingDomains, error: domainError } = await admin.schema("mediasis").from("storefront_domains")
    .select("storefront_domain_id").eq("source", "purchased")
    .in("verification_status", ["dns_pending", "vercel_pending"]).limit(3);
  if (domainError) console.error("Purchased domain recovery query failed", domainError);
  await Promise.allSettled((pendingDomains ?? []).map(async (domain) => {
    try { await refreshPurchasedDomain(domain.storefront_domain_id); }
    catch (failure) { console.error("Purchased domain activation failed", { domainId: domain.storefront_domain_id, failure }); }
  }));
  const { data: activeDomains, error: activeDomainError } = await admin.schema("mediasis").from("storefront_domains")
    .select("storefront_domain_id").eq("source", "purchased").eq("is_primary", true).eq("verification_status", "active").limit(50);
  if (activeDomainError) console.error("Purchased primary-domain sync query failed", activeDomainError);
  await Promise.allSettled((activeDomains ?? []).map(async (domain) => {
    try { await syncPurchasedPrimaryDomain(domain.storefront_domain_id); }
    catch (failure) { console.error("Purchased primary-domain sync failed", { domainId: domain.storefront_domain_id, failure }); }
  }));
  return NextResponse.json({ checked: data?.length ?? 0, domainsChecked: pendingDomains?.length ?? 0, primaryDomainsSynced: activeDomains?.length ?? 0 });
}
