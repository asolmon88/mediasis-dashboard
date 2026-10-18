import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const ASSOCIATION_PATH = "/.well-known/apple-developer-merchantid-domain-association";
const ONVO_URL = "https://api.onvopay.com/v1/payment-method-domains";
const VALIDATION_COOLDOWN_MS = 60_000;

type Admin = ReturnType<typeof createAdminClient>;
type Registration = {
  id?: string;
  domainName?: string;
  enabled?: boolean;
  mode?: string;
  applePay?: { status?: string; statusDetails?: { errorMessage?: string } };
};
type Account = { reference: string; secret: string; onvoKeysId: string | null; platformConfigId: string | null; source: "business" | "platform" };
type Domain = { storefront_domain_id: string; apex_domain: string; www_domain: string | null; verification_status: string; disconnected_at: string | null; verification_details: { simulated_registration?: boolean } | null };

export type ApplePayDomainStatus = {
  hostname: string;
  storefrontDomainId: string;
  state: "unavailable" | "not_registered" | "pending" | "active" | "inactive" | "disabled";
  mode: string | null;
  enabled: boolean | null;
  error: string | null;
  lastValidationAt: string | null;
};

function hostnames(domain: Domain) {
  return [...new Set([domain.apex_domain, domain.www_domain].filter((value): value is string => Boolean(value)))]
    .filter((value) => /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value));
}

async function eligible(admin: Admin, businessId: string) {
  const [{ data: business, error: businessError }, { data: domains, error: domainError }, { data: accounts, error: accountError }, { data: methods, error: methodError }] = await Promise.all([
    admin.schema("mediasis").from("businesses").select("payment_provider,payments_enabled").eq("uid", businessId).maybeSingle(),
    admin.schema("mediasis").from("storefront_domains").select("storefront_domain_id,apex_domain,www_domain,verification_status,disconnected_at,verification_details").eq("business_id", businessId).eq("verification_status", "active").is("disconnected_at", null),
    admin.schema("mediasis").from("onvo_keys").select("onvo_keys_id,secret_key,credential_source,marketplace_connection_id,scope").eq("business_id", businessId).eq("enabled", true).is("disabled_at", null),
    admin.schema("mediasis").from("business_payment_method").select("payment_method:payment_method_id(name)").eq("business_id", businessId).eq("visible", true),
  ]);
  if (businessError || domainError || accountError || methodError) throw new Error("No se pudo consultar la configuración de Apple Pay.");
  const cardEnabled = (methods ?? []).some((row) => {
    const method = row.payment_method as unknown as { name?: string } | null;
    return /^(card|tarjeta)$/i.test(method?.name?.trim() ?? "");
  });
  // Domains used by connected merchants are registered on Mediasis's parent
  // account. A direct ONVO merchant continues to use its own secret key.
  let account: Account | null = null;
  // Match the order-app resolver: an active business-owned all-location key
  // wins; otherwise use the connected merchant's effective platform key.
  const key = (accounts ?? []).find((row) => row.scope === "all" && row.credential_source === "business")
    ?? (accounts ?? []).find((row) => row.scope === "all" && row.credential_source === "marketplace")
    ?? (accounts?.length === 1 ? accounts[0] : null);
  if (key) {
    if (key.credential_source === "business" && key.secret_key) {
      account = { reference: `business:${key.onvo_keys_id}`, secret: key.secret_key, onvoKeysId: key.onvo_keys_id, platformConfigId: null, source: "business" };
    } else if (key.credential_source === "marketplace" && key.marketplace_connection_id) {
      const { data: connection, error: connectionError } = await admin.schema("mediasis").from("business_onvo_marketplace_connections")
        .select("status,connected_account_id,onvo_marketplace_platform_config_id")
        .eq("business_onvo_marketplace_connection_id", key.marketplace_connection_id).eq("business_id", businessId).maybeSingle();
      if (connectionError) throw new Error("No se pudo verificar la cuenta ONVO conectada.");
      if (connection?.status === "active" && connection.connected_account_id && connection.onvo_marketplace_platform_config_id) {
        const { data: platform, error: platformError } = await admin.schema("mediasis").from("onvo_marketplace_platform_configs")
          .select("onvo_marketplace_platform_config_id,secret_key")
          .eq("onvo_marketplace_platform_config_id", connection.onvo_marketplace_platform_config_id).eq("enabled", true).maybeSingle();
        if (platformError) throw new Error("No se pudo consultar la cuenta ONVO principal.");
        if (platform?.secret_key) account = {
          reference: `platform:${platform.onvo_marketplace_platform_config_id}`, secret: platform.secret_key,
          onvoKeysId: null, platformConfigId: platform.onvo_marketplace_platform_config_id, source: "platform",
        };
      }
    }
  }
  return {
    domains: (domains ?? []).filter((domain) => domain.verification_details?.simulated_registration !== true) as Domain[],
    account,
    ready: business?.payment_provider === "onvo" && business.payments_enabled === true && cardEnabled,
  };
}

async function associationReady(hostname: string) {
  try {
    const response = await fetch(`https://${hostname}${ASSOCIATION_PATH}`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return response.status === 200;
  } catch { return false; }
}

async function onvoRequest(secret: string, path: string, method: "GET" | "POST", body?: object) {
  const response = await fetch(`${ONVO_URL}${path}`, {
    method, headers: { Authorization: `Bearer ${secret}`, Accept: "application/json", "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as Registration | { data?: Registration; message?: string } | null;
  if (!response.ok) throw new Error((payload && "message" in payload && payload.message) || `ONVO respondió ${response.status}.`);
  return (payload && "data" in payload && payload.data ? payload.data : payload) as Registration;
}

async function saveStatus(admin: Admin, businessId: string, domainId: string, hostname: string, account: Account, result: Registration, priorValidationAt?: string | null) {
  if (!result.id || result.domainName?.toLowerCase() !== hostname) throw new Error("ONVO devolvió un dominio diferente al solicitado.");
  const mode = result.mode === "live" ? "live" : result.mode === "test" ? "test" : account.secret.startsWith("onvo_live_") ? "live" : "test";
  const { error } = await admin.schema("mediasis").from("onvo_apple_pay_domains").upsert({
    business_id: businessId, storefront_domain_id: domainId, hostname, onvo_keys_id: account.onvoKeysId,
    onvo_marketplace_platform_config_id: account.platformConfigId,
    account_reference: account.reference, mode, onvo_domain_id: result.id, enabled: result.enabled ?? null,
    apple_pay_status: result.applePay?.status ?? null,
    status_error: result.applePay?.statusDetails?.errorMessage?.slice(0, 500) ?? null,
    last_checked_at: new Date().toISOString(), last_validation_at: priorValidationAt ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "business_id,hostname,account_reference,mode" });
  if (error) throw new Error("No se pudo guardar el estado de Apple Pay.");
}

export async function listApplePayDomains(admin: Admin, businessId: string): Promise<ApplePayDomainStatus[]> {
  const config = await eligible(admin, businessId);
  if (!config.ready) return [];
  const { data: saved, error } = await admin.schema("mediasis").from("onvo_apple_pay_domains").select("hostname,storefront_domain_id,account_reference,mode,enabled,apple_pay_status,status_error,last_validation_at").eq("business_id", businessId);
  if (error) throw new Error("No se pudo consultar el estado de Apple Pay.");
  return config.domains.flatMap((domain) => hostnames(domain).map((hostname) => {
    const row = (saved ?? []).find((item) => item.hostname === hostname && item.account_reference === config.account?.reference);
    const unavailable = !config.account;
    return {
      hostname, storefrontDomainId: domain.storefront_domain_id,
      state: unavailable ? "unavailable" as const : !row ? "not_registered" as const : row.enabled === false ? "disabled" as const : row.apple_pay_status === "active" ? "active" as const : row.apple_pay_status === "inactive" ? "inactive" as const : "pending" as const,
      mode: row?.mode ?? null, enabled: row?.enabled ?? null, error: row?.status_error ?? null, lastValidationAt: row?.last_validation_at ?? null,
    };
  }));
}

export async function syncApplePayDomain(admin: Admin, businessId: string, domainId: string, hostname: string, action: "register" | "refresh" | "validate") {
  const config = await eligible(admin, businessId);
  const domain = config.domains.find((item) => item.storefront_domain_id === domainId && hostnames(item).includes(hostname));
  if (!config.ready || !domain) throw new Error("El dominio o los pagos con tarjeta no están activos.");
  if (!config.account) throw new Error("La cuenta ONVO para este negocio no está lista.");
  const account = config.account!;
  const mode = account.secret.startsWith("onvo_live_") ? "live" : "test";
  const { data: existing, error } = await admin.schema("mediasis").from("onvo_apple_pay_domains")
    .select("onvo_domain_id,last_validation_at").eq("business_id", businessId).eq("hostname", hostname)
    .eq("account_reference", account.reference).eq("mode", mode).maybeSingle();
  if (error) throw new Error("No se pudo consultar el registro anterior.");
  if (action === "validate" && existing?.last_validation_at && Date.now() - new Date(existing.last_validation_at).getTime() < VALIDATION_COOLDOWN_MS) {
    throw new Error("Esperá un minuto antes de volver a validar este dominio.");
  }
  if (action !== "refresh" && !await associationReady(hostname)) throw new Error("El archivo de Apple Pay debe responder 200 directamente en este dominio HTTPS.");
  if (action !== "register" && !existing?.onvo_domain_id) throw new Error("Primero registrá el dominio en ONVO.");
  if (action === "validate") {
    const cutoff = new Date(Date.now() - VALIDATION_COOLDOWN_MS).toISOString();
    const { data: reserved, error: reserveError } = await admin.schema("mediasis").from("onvo_apple_pay_domains")
      .update({ last_validation_at: new Date().toISOString() })
      .eq("business_id", businessId).eq("hostname", hostname).eq("account_reference", account.reference).eq("mode", mode)
      .or(`last_validation_at.is.null,last_validation_at.lt.${cutoff}`)
      .select("onvo_apple_pay_domain_id").maybeSingle();
    if (reserveError || !reserved) throw new Error("Esperá un minuto antes de volver a validar este dominio.");
  }
  const path = action === "register" && !existing?.onvo_domain_id ? "" : `/${encodeURIComponent(existing!.onvo_domain_id)}`;
  const result = action === "validate"
    ? await onvoRequest(account.secret, `${path}/validate`, "POST")
    : action === "refresh" || existing?.onvo_domain_id
      ? await onvoRequest(account.secret, path, "GET")
      : await onvoRequest(account.secret, "", "POST", { domainName: hostname });
  await saveStatus(admin, businessId, domainId, hostname, account, result, action === "validate" ? new Date().toISOString() : existing?.last_validation_at);
}
