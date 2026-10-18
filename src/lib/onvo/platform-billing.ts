import "server-only";

const ONVO_API = "https://api.onvopay.com/v1";

type OnvoCard = {
  id: string;
  customerId?: string | null;
  customer?: { id?: string | null } | null;
  card?: { brand?: string | null; last4?: string | null } | null;
  type?: string | null;
};

export type OnvoPlatformConfig = {
  publishableKey: string;
  secretKey: string;
};

export async function getOnvoPlatformConfig(admin: any, businessId: string): Promise<OnvoPlatformConfig> {
  const { data: market, error: marketError } = await admin.schema("mediasis")
    .from("business_market_settings").select("country_code").eq("business_id", businessId).maybeSingle();
  if (marketError || !market?.country_code) throw new Error("No se pudo determinar el mercado de facturación.");
  const { data: config, error: configError } = await admin.schema("mediasis")
    .from("onvo_marketplace_platform_configs")
    .select("publishable_key,secret_key,enabled,platform_billing_enabled")
    .eq("country_code", market.country_code).maybeSingle();
  if (configError || !config?.enabled || !config.platform_billing_enabled || !config.publishable_key || !config.secret_key) {
    throw new Error("La facturación con Onvo todavía no está configurada para este mercado.");
  }
  return { publishableKey: config.publishable_key, secretKey: config.secret_key };
}

async function onvo(secretKey: string, path: string) {
  const response = await fetch(`${ONVO_API}${path}`, {
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Onvo no pudo verificar la tarjeta.");
  return data as OnvoCard;
}

/** Validate an opaque browser-created payment method before linking it locally. */
export async function verifyOnvoPlatformCard(input: { secretKey: string; paymentMethodId: string; customerId: string }) {
  const method = await onvo(input.secretKey, `/payment-methods/${encodeURIComponent(input.paymentMethodId)}`);
  const returnedCustomerId = method.customerId ?? method.customer?.id ?? null;
  if (method.type !== "card" || !returnedCustomerId || returnedCustomerId !== input.customerId) {
    throw new Error("La tarjeta de Onvo no pertenece al cliente de facturación indicado.");
  }
  const last4 = method.card?.last4 ?? null;
  if (!last4 || !/^\d{4}$/.test(last4)) throw new Error("Onvo no devolvió los últimos cuatro dígitos de la tarjeta.");
  return { brand: method.card?.brand ?? null, last4, customerId: returnedCustomerId };
}
