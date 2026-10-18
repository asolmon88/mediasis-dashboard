/** Only these bounded diagnostics are persisted; never store processor payloads. */
export type BillingDeclineCategory = "insufficient_funds" | "authentication_failed" | "bank_declined" | "unknown";

type Failure = { code?: unknown; message?: unknown } | null;
type IntentFailure = { lastPaymentError?: Failure; charges?: Array<{ failureCode?: unknown; failureMessage?: unknown }> | null };

export function classifyOnvoDecline(intent: IntentFailure, webhookError?: Failure): { category: BillingDeclineCategory; code: string | null } {
  const failures = [intent.lastPaymentError, ...(intent.charges ?? []).map((charge) => ({ code: charge.failureCode, message: charge.failureMessage })), webhookError];
  const text = failures.flatMap((failure) => [failure?.code, failure?.message]).filter((value): value is string => typeof value === "string").join(" ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const code = failures.map((failure) => failure?.code).find((value): value is string => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value)) ?? null;
  const category: BillingDeclineCategory = /insufficient[ _-]?funds|fondos insuficientes/.test(text) ? "insufficient_funds"
    : /3ds|authenticat|autenticacion/.test(text) ? "authentication_failed"
    : /declin|rechaz|do[ _-]?not[ _-]?honor|issuer/.test(text) ? "bank_declined" : "unknown";
  return { category, code };
}

export function declineMessage(category: BillingDeclineCategory): string {
  switch (category) {
    case "insufficient_funds": return "Fondos insuficientes. Podés intentar de nuevo con esta tarjeta o elegir otra.";
    case "authentication_failed": return "No se completó la verificación de seguridad del banco. Podés volver a intentarlo.";
    case "bank_declined": return "El banco rechazó el pago. Podés intentar de nuevo o usar otra tarjeta.";
    default: return "No se pudo confirmar el pago. Podés intentar de nuevo o elegir otra tarjeta.";
  }
}
