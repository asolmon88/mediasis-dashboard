"use server";

import { PaymentMethodSchema, type PaymentMethodInput } from "@/lib/FormSchemas/paymentMethodSchema";
import { requirePaymentMethodManagementAccess } from "@/lib/dashboard/payments-cashback-authorization";
import type { payment_methods_for_table } from "@/lib/types/dashboardTypes";
import { listApplePayDomains, syncApplePayDomain } from "@/lib/onvo/apple-pay-domains";

type UpdatePaymentMethodBusinessArgs = {
  business_payment_method_id: string;
  data: PaymentMethodInput;
};

type RpcResult = { success?: boolean; message?: string };
type ElectronicMethod = "card" | "sinpe";
type MarketplaceConnection = {
  status: string;
  connected_account_id: string | null;
  onboarding_url: string | null;
  merchant_terms_accepted_at: string | null;
  last_error: string | null;
};

const ONVO_API_URL = "https://api.onvopay.com";
const electronicMethodLabel = (method: ElectronicMethod) => method === "card" ? "Tarjeta" : "SINPE Móvil";

function publicConnection(connection: MarketplaceConnection | null) {
  return connection ? {
    status: connection.status,
    hasConnectedAccount: Boolean(connection.connected_account_id),
    onboardingUrl: connection.onboarding_url,
    lastError: connection.last_error,
  } : null;
}

async function marketplaceConnectionForAccess(access: Awaited<ReturnType<typeof requirePaymentMethodManagementAccess>>) {
  if (!access.success) return null;
  const { data } = await access.admin
    .schema("mediasis")
    .from("business_onvo_marketplace_connections")
    .select("status,connected_account_id,onboarding_url,merchant_terms_accepted_at,last_error")
    .eq("business_id", access.businessId)
    .maybeSingle();
  return (data ?? null) as MarketplaceConnection | null;
}

async function refreshMarketplaceConnection(access: Awaited<ReturnType<typeof requirePaymentMethodManagementAccess>>, regenerate = false) {
  if (!access.success) return { success: false as const, message: access.message };
  const { data: connection, error: connectionError } = await access.admin
    .schema("mediasis")
    .from("business_onvo_marketplace_connections")
    .select("business_onvo_marketplace_connection_id,connected_account_id,onvo_marketplace_platform_config_id")
    .eq("business_id", access.businessId)
    .maybeSingle();
  if (connectionError || !connection?.connected_account_id) {
    return { success: false as const, message: "Todavía no hay una cuenta de pagos para consultar." };
  }
  const { data: config, error: configError } = await access.admin
    .schema("mediasis")
    .from("onvo_marketplace_platform_configs")
    .select("secret_key")
    .eq("onvo_marketplace_platform_config_id", connection.onvo_marketplace_platform_config_id)
    .eq("enabled", true)
    .maybeSingle();
  if (configError || !config?.secret_key) return { success: false as const, message: "Los pagos electrónicos no están configurados para este mercado." };

  const path = regenerate
    ? `/v1/connected-accounts/${encodeURIComponent(connection.connected_account_id)}/onboarding-link`
    : `/v1/connected-accounts/${encodeURIComponent(connection.connected_account_id)}`;
  let response: Response;
  let payload: Record<string, unknown> | null = null;
  try {
    response = await fetch(`${ONVO_API_URL}${path}`, {
      method: regenerate ? "POST" : "GET",
      headers: { Authorization: `Bearer ${config.secret_key}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
    payload = await response.json().catch(() => null);
  } catch {
    return { success: false as const, message: "No se pudo consultar la cuenta. Intentá de nuevo; no se creó una cuenta adicional." };
  }
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "No se pudo actualizar el enlace de onboarding.";
    return { success: false as const, message };
  }
  const result = (payload?.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
  const status = typeof result?.status === "string" ? result.status : "pending_onboarding";
  const onboardingUrl = typeof result?.onboardingUrl === "string" ? result.onboardingUrl : undefined;
  const { error: syncError } = await access.admin.schema("mediasis").rpc("sync_onvo_marketplace_connection_status", {
    p_connection_id: connection.business_onvo_marketplace_connection_id,
    p_status: status,
    p_onboarding_url: onboardingUrl ?? null,
  });
  if (syncError) return { success: false as const, message: "No se pudo guardar el estado de la cuenta de pagos." };
  return { success: true as const, connection: publicConnection(await marketplaceConnectionForAccess(access)) };
}

export async function saveManualPaymentMethod({ payeeName, instructions }: { payeeName: string; instructions: string }) {
  if (!payeeName.trim() || !instructions.trim()) {
    return { success: false, message: "Ingresá el nombre del beneficiario y las instrucciones de pago." };
  }
  const access = await requirePaymentMethodManagementAccess();
  if (!access.success) return access;
  if (access.paymentMethodsManagedByMediasis) {
    return { success: false, message: "Los métodos de pago del plan Uber los configura Mediasis." };
  }
  const { data, error } = await access.admin.schema("mediasis").rpc("save_ordering_app_manual_payment_method", {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
    p_payee_name: payeeName.trim(),
    p_instructions: instructions.trim(),
  });
  const result = data as RpcResult | null;
  return error || !result?.success
    ? { success: false, message: error?.message ?? result?.message ?? "No se pudo guardar el método Manual." }
    : { success: true };
}

export async function getOrderingAppPaymentMethods() {
  const access = await requirePaymentMethodManagementAccess();
  if (!access.success) return { ...access, paymentMethods: [] as payment_methods_for_table };

  const { data, error } = await access.admin.schema("mediasis").rpc("get_ordering_app_payment_methods", {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
  });
  if (error) {
    return {
      success: false as const,
      message: "No se pudieron cargar los métodos de pago.",
      paymentMethods: [] as payment_methods_for_table,
    };
  }
  return {
    success: true as const,
    paymentMethods: (data ?? []) as payment_methods_for_table,
    canManageAllLocations: access.canManageAllLocations,
    paymentMethodsManagedByMediasis: access.paymentMethodsManagedByMediasis,
    countryCode: access.context.market?.countryCode ?? null,
    marketplaceConnection: publicConnection(await marketplaceConnectionForAccess(access)),
    applePayDomains: await listApplePayDomains(access.admin, access.businessId).catch(() => []),
    canManageApplePay: access.context.mode === "staff" || Boolean(access.context.appUserId && (await access.admin.schema("mediasis").from("business_account_owners").select("owner_app_user_id").eq("business_id", access.businessId).maybeSingle()).data?.owner_app_user_id === access.context.appUserId),
  };
}

export async function updateApplePayDomain(input: { domainId: string; hostname: string; action: "register" | "refresh" | "validate" }) {
  const access = await requirePaymentMethodManagementAccess();
  if (!access.success) return { success: false as const, message: access.message };
  if (access.context.mode !== "staff") {
    const { data: owner, error } = await access.admin.schema("mediasis").from("business_account_owners")
      .select("owner_app_user_id").eq("business_id", access.businessId).maybeSingle();
    if (error || !access.context.appUserId || owner?.owner_app_user_id !== access.context.appUserId) {
      return { success: false as const, message: "Solo el propietario puede verificar Apple Pay." };
    }
  }
  if (!/^[a-f0-9-]{36}$/i.test(input.domainId) || !/^[a-z0-9.-]{1,253}$/.test(input.hostname) || !["register", "refresh", "validate"].includes(input.action)) {
    return { success: false as const, message: "Solicitud inválida." };
  }
  try {
    await syncApplePayDomain(access.admin, access.businessId, input.domainId, input.hostname, input.action);
    return { success: true as const, domains: await listApplePayDomains(access.admin, access.businessId) };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "No se pudo actualizar Apple Pay." };
  }
}

export async function startElectronicPaymentSetup({ method, acceptedTerms }: { method: ElectronicMethod; acceptedTerms: boolean }) {
  if (method !== "card" && method !== "sinpe") return { success: false as const, message: "Método de pago inválido." };
  const access = await requirePaymentMethodManagementAccess();
  if (!access.success) return access;
  if (access.paymentMethodsManagedByMediasis) return { success: false as const, message: "Los métodos de pago del plan Uber los configura Mediasis." };
  if ((access.context.market?.countryCode ?? "").toUpperCase() !== "CR") {
    return { success: false as const, message: "Los pagos electrónicos todavía no están disponibles para este país." };
  }
  const { data: begun, error: beginError } = await access.admin.schema("mediasis").rpc("begin_onvo_marketplace_connection", {
    p_business_id: access.businessId, p_actor_app_user_id: access.actorAppUserId, p_terms_accepted: acceptedTerms,
  });
  const begin = begun as { action?: string; connection_id?: string } | null;
  if (beginError || !begin?.action || !begin.connection_id) {
    const detail = beginError?.message ?? "";
    return {
      success: false as const,
      message: /Electronic payments are not configured for this market/i.test(detail)
        ? "Los pagos electrónicos todavía no están habilitados para Costa Rica. Mediasis debe configurar la cuenta principal antes de poder solicitar el onboarding."
        : detail || "No se pudo iniciar la configuración de pagos.",
    };
  }
  if (begin.action === "unknown") return { success: false as const, message: "Estamos verificando una solicitud anterior. Contactá a Mediasis si no cambia en unos minutos." };
  if (begin.action !== "create") return { success: true as const, connection: publicConnection(await marketplaceConnectionForAccess(access)), requestedMethod: method };

  const [{ data: config }, { data: business }] = await Promise.all([
    access.admin.schema("mediasis").from("onvo_marketplace_platform_configs").select("secret_key").eq("country_code", "CR").eq("enabled", true).maybeSingle(),
    access.admin.schema("mediasis").from("businesses").select("full_name").eq("uid", access.businessId).maybeSingle(),
  ]);
  if (!config?.secret_key || !business?.full_name) return { success: false as const, message: "No se pudo preparar el negocio para el onboarding de pagos." };
  try {
    const response = await fetch(`${ONVO_API_URL}/v1/connected-accounts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.secret_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ businessName: business.full_name.trim().slice(0, 50), marketplaceAppFee: 2 }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      await access.admin.schema("mediasis").rpc("fail_onvo_marketplace_connection", {
        p_connection_id: begin.connection_id, p_unknown: false, p_error: typeof payload?.message === "string" ? payload.message : "ONVO rejected the account request",
      });
      return { success: false as const, message: "No se pudo crear la cuenta de pagos. Revisá los datos del negocio e intentá de nuevo." };
    }
    const result = (payload?.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
    const accountId = typeof result?.id === "string" ? result.id : null;
    if (!accountId) throw new Error("ONVO did not return a connected account id");
    const status = typeof result.status === "string" ? result.status : "pending_onboarding";
    const onboardingUrl = typeof result.onboardingUrl === "string" ? result.onboardingUrl : "";
    const { error: completeError } = await access.admin.schema("mediasis").rpc("complete_onvo_marketplace_connection", {
      p_connection_id: begin.connection_id, p_connected_account_id: accountId, p_status: status, p_onboarding_url: onboardingUrl,
    });
    if (completeError) return { success: false as const, message: "La cuenta se creó, pero no se pudo guardar su estado. Contactá a Mediasis antes de volver a intentarlo." };
    return { success: true as const, connection: publicConnection(await marketplaceConnectionForAccess(access)), requestedMethod: method };
  } catch {
    // A network timeout has an unknown side effect.  Never issue a second create request.
    await access.admin.schema("mediasis").rpc("fail_onvo_marketplace_connection", {
      p_connection_id: begin.connection_id, p_unknown: true, p_error: "Marketplace account creation request could not be confirmed",
    });
    return { success: false as const, message: "No pudimos confirmar la solicitud. No creamos una segunda cuenta; Mediasis debe verificar la primera." };
  }
}

export async function refreshElectronicPaymentSetup({ regenerate = false }: { regenerate?: boolean } = {}) {
  const access = await requirePaymentMethodManagementAccess();
  if (!access.success) return access;
  if (access.paymentMethodsManagedByMediasis) return { success: false as const, message: "Los métodos de pago del plan Uber los configura Mediasis." };
  return refreshMarketplaceConnection(access, regenerate);
}

export async function enableElectronicPaymentMethod({ method }: { method: ElectronicMethod }) {
  const access = await requirePaymentMethodManagementAccess();
  if (!access.success) return access;
  if (access.paymentMethodsManagedByMediasis) return { success: false as const, message: "Los métodos de pago del plan Uber los configura Mediasis." };
  await refreshMarketplaceConnection(access);
  const { data, error } = await access.admin.schema("mediasis").rpc("enable_onvo_marketplace_payment_method", {
    p_business_id: access.businessId, p_actor_app_user_id: access.actorAppUserId, p_method: method,
  });
  const result = data as RpcResult | null;
  return error || !result?.success
    ? { success: false as const, message: error?.message ?? result?.message ?? `No se pudo activar ${electronicMethodLabel(method)}.` }
    : { success: true as const };
}

export async function updatePaymentMethodBusiness({
  business_payment_method_id,
  data,
}: UpdatePaymentMethodBusinessArgs) {
  const parsed = PaymentMethodSchema.safeParse(data);
  if (!parsed.success) return { success: false, message: "Revisá la configuración del método de pago." };

  const access = await requirePaymentMethodManagementAccess();
  if (!access.success) return access;
  if (access.paymentMethodsManagedByMediasis) {
    return { success: false, message: "Los métodos de pago del plan Uber los configura Mediasis." };
  }

  const locationIds = Array.from(new Set(
    (parsed.data.business_location_ids ?? []).map((value) => value.trim()).filter(Boolean),
  ));
  if (parsed.data.scope === "all" && locationIds.length > 0) {
    return { success: false, message: "Una configuración global no puede incluir ubicaciones específicas." };
  }
  const { data: resultData, error } = await access.admin
    .schema("mediasis")
    .rpc("update_ordering_app_payment_method", {
      p_business_id: access.businessId,
      p_actor_app_user_id: access.actorAppUserId,
      p_business_payment_method_id: business_payment_method_id,
      p_visible: parsed.data.visible,
      p_scope: parsed.data.scope,
      p_location_ids: locationIds,
    });
  const result = resultData as RpcResult | null;
  if (error || !result?.success) {
    return {
      success: false,
      message: error?.message ?? result?.message ?? "No se pudo guardar el método de pago.",
    };
  }
  return { success: true };
}
