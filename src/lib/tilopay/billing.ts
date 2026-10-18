import "server-only";
import { parseTilopayLifecycle, type TilopayTransaction } from "./lifecycle";

type TilopaySdkCredentials = { apiUser: string; apiPassword: string; apiKey: string };

export function getTilopayBillingCredentials(): TilopaySdkCredentials {
  const apiUser = process.env.TILOPAY_API_USER?.trim();
  const apiPassword = process.env.TILOPAY_API_PASSWORD?.trim();
  const apiKey = process.env.TILOPAY_API_KEY?.trim();
  if (!apiUser || !apiPassword || !apiKey) throw new Error("La facturación con Tilopay todavía no está configurada.");
  return { apiUser, apiPassword, apiKey };
}

export async function createTilopaySdkToken() {
  const credentials = getTilopayBillingCredentials();
  const response = await fetch("https://app.tilopay.com/api/v1/loginSdk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiuser: credentials.apiUser, password: credentials.apiPassword, key: credentials.apiKey }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: string | number; message?: string } | null;
  if (!response.ok || !payload?.access_token) throw new Error(payload?.message ?? "Tilopay no devolvió un token para la tarjeta.");
  return { token: payload.access_token, expiresAt: payload.expires_in == null ? null : String(payload.expires_in) };
}

async function createTilopayApiToken() {
  const credentials = getTilopayBillingCredentials();
  const response = await fetch("https://app.tilopay.com/api/v1/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiuser: credentials.apiUser, password: credentials.apiPassword }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; message?: string } | null;
  if (!response.ok || !payload?.access_token) throw new Error(payload?.message ?? "Tilopay no devolvió un token de consulta.");
  return { token: payload.access_token, apiKey: credentials.apiKey };
}

export type TilopayRecurringChargeResult = {
  success: boolean;
  transactionId: string | null;
  authorizationCode: string | null;
  response: Record<string, unknown> | null;
  message: string;
};

/** Charges a saved Tilopay v2 token. The caller must persist the order number
 * before invoking this function and consult it after an uncertain response. */
export async function chargeTilopaySavedCard(input: {
  orderNumber: string;
  amountMinor: number;
  currency: string;
  email: string;
  cardToken: string;
}): Promise<TilopayRecurringChargeResult> {
  const { token, apiKey } = await createTilopayApiToken();
  const response = await fetch("https://app.tilopay.com/api/v1/processRecurrentPayment", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      key: apiKey,
      amount: (input.amountMinor / 100).toFixed(2),
      currency: input.currency,
      orderNumber: input.orderNumber,
      capture: "1",
      email: input.email,
      card: input.cardToken,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const approved = response.ok && (String(payload?.response) === "1" || String(payload?.type) === "200");
  return {
    success: approved,
    transactionId: payload?.tilopayTransaction == null ? null : String(payload.tilopayTransaction),
    authorizationCode: payload?.auth == null ? null : String(payload.auth),
    response: payload,
    message: String(payload?.description ?? payload?.message ?? (approved ? "Pago aprobado" : "Tilopay rechazó el pago")),
  };
}

/** Captures a previously authorized amount. Tilopay operation type 1 is capture. */
export async function captureTilopayAuthorization(orderNumber: string, amount: string) {
  const { token, apiKey } = await createTilopayApiToken();
  const response = await fetch("https://app.tilopay.com/api/v1/processModification", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ orderNumber, type: "1", amount, key: apiKey }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { transactionId?: string | number; ReasonCode?: string | number; ReasonCodeDescription?: string } | null;
  if (!response.ok || String(payload?.ReasonCode) !== "1") throw new Error(payload?.ReasonCodeDescription ?? "Tilopay no pudo capturar el pago autorizado.");
  return String(payload?.transactionId ?? "");
}

export type TilopayPaymentStatus = "approved" | "declined" | "unknown";
export type TilopayFailureCategory = "bank_unavailable" | "insufficient_funds" | "invalid_cvv" | "authentication_declined" | "card_declined" | "verification_unknown";

export function classifyTilopayTransaction(transaction: TilopayTransaction | null): {
  status: TilopayPaymentStatus;
  failureCategory: TilopayFailureCategory | null;
  customerMessage: string;
} {
  if (!transaction) return { status: "unknown", failureCategory: "verification_unknown", customerMessage: "No pudimos confirmar el estado del pago todavía." };
  const code = String(transaction.code ?? "").trim();
  const response = String(transaction.response ?? "").toLowerCase();
  if (code === "1") return { status: "approved", failureCategory: null, customerMessage: "El pago fue autorizado." };
  if (response.includes("did not respond") || response.includes("no respondi") || response.includes("sin respuesta")) return { status: "declined", failureCategory: "bank_unavailable", customerMessage: "Tu banco no confirmó el pago. No se capturó ningún cargo. Intentá con otra tarjeta o consultá con tu banco." };
  if (code === "51" || response.includes("insufficient funds") || response.includes("fondos insuficientes")) return { status: "declined", failureCategory: "insufficient_funds", customerMessage: "Tu tarjeta no tiene fondos suficientes para completar el pago." };
  if (code === "82" || response.includes("invalid cvv") || response.includes("cvv inválido")) return { status: "declined", failureCategory: "invalid_cvv", customerMessage: "El código de seguridad de la tarjeta no es válido." };
  if (code === "12" || response.includes("3ds") || response.includes("authentication")) return { status: "declined", failureCategory: "authentication_declined", customerMessage: "Tu banco rechazó la confirmación de seguridad del pago. Intentá de nuevo o consultá con tu banco." };
  if (!code || code === "0") return { status: "unknown", failureCategory: "verification_unknown", customerMessage: "No pudimos confirmar el estado del pago todavía." };
  return { status: "declined", failureCategory: "card_declined", customerMessage: "Tu banco rechazó el pago. Intentá con otra tarjeta o consultá con tu banco." };
}

/** Tilopay can return an authorization and a later C- capture for one order. */
export async function consultTilopayLifecycle(orderNumber: string, expectedMinor: number, currency: string) {
  const { token, apiKey } = await createTilopayApiToken();
  const response = await fetch("https://app.tilopay.com/api/v1/consult", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ key: apiKey, orderNumber, merchantId: "" }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { response?: TilopayTransaction[]; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? "Tilopay no pudo confirmar la transacción.");
  return parseTilopayLifecycle(payload?.response ?? [], orderNumber, expectedMinor, currency);
}
