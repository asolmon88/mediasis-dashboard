import "server-only";

import { ensurePurchasedDomainDns } from "@/lib/cloudflare/dns";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachOrderingAppDomain } from "@/lib/vercel/domains";

export async function syncPurchasedPrimaryDomain(domainId: string) {
  const admin = createAdminClient();
  const { data: domain, error } = await admin.schema("mediasis").from("storefront_domains")
    .select("business_id,apex_domain,is_primary,source,verification_status")
    .eq("storefront_domain_id", domainId).maybeSingle();
  if (error) throw error;
  if (!domain || domain.source !== "purchased" || !domain.is_primary || domain.verification_status !== "active") return;
  const { data: legacy, error: lookupError } = await admin.schema("mediasis").from("business_domain")
    .select("business_domain_id,domain").eq("business_uid", domain.business_id).eq("type", "order_app").eq("is_internal_storefront", false).maybeSingle();
  if (lookupError) throw lookupError;
  if (legacy?.domain === domain.apex_domain) return;
  const query = admin.schema("mediasis").from("business_domain");
  const { error: legacyError } = legacy
    ? await query.update({ domain: domain.apex_domain }).eq("business_domain_id", legacy.business_domain_id)
    : await query.insert({ business_uid: domain.business_id, type: "order_app", domain: domain.apex_domain });
  if (legacyError) throw legacyError;
}

export async function refreshPurchasedDomain(domainId: string) {
  const admin = createAdminClient();
  const { data: domain, error } = await admin.schema("mediasis").from("storefront_domains")
    .select("business_id,apex_domain,is_primary,source,verification_status")
    .eq("storefront_domain_id", domainId).maybeSingle();
  if (error || !domain || domain.source !== "purchased" || domain.verification_status === "disconnected") return;
  const setup = await attachOrderingAppDomain(domain.apex_domain);
  await ensurePurchasedDomainDns(domain.apex_domain, setup.records);
  // Vercel may need another cycle after the records are written.
  const current = setup.dnsConfigured ? setup : await attachOrderingAppDomain(domain.apex_domain);
  let httpsReady = false;
  if (current.verified && current.dnsConfigured) {
    try {
      const response = await fetch(`https://${domain.apex_domain}`, { method: "HEAD", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(12_000) });
      httpsReady = response.status > 0 && response.status < 500;
    } catch { /* Wait for certificate or DNS propagation. */ }
  }
  const active = current.verified && current.dnsConfigured && httpsReady;
  const { error: updateError } = await admin.schema("mediasis").from("storefront_domains")
    .update({ verification_status: active ? "active" : current.verified ? "vercel_pending" : "dns_pending",
      www_domain: current.alias, dns_requirements: current.records,
      verification_details: { managed_hostnames: current.managedHostnames, dns_configured: current.dnsConfigured, https_ready: httpsReady },
      activated_at: active ? new Date().toISOString() : null, last_error: null })
    .eq("storefront_domain_id", domainId);
  if (updateError) throw updateError;
  if (active && domain.is_primary) await syncPurchasedPrimaryDomain(domainId);
}
