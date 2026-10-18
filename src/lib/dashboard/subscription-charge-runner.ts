import "server-only";

import { sendSubscriptionBillingEmail } from "@/lib/emails/subscription-billing";
import { getOnvoPlatformConfig } from "@/lib/onvo/platform-billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyOnvoDecline } from "@/lib/onvo/billing-decline";

export type ClaimedSubscriptionCharge = {
  business_subscription_charge_id: string;
  business_subscription_charge_attempt_id: string;
  business_id: string;
  local_reference: string;
  amount_minor: number;
  currency_code: string;
  customer_id: string;
  payment_method_id: string;
  cardholder_email: string;
  kind: "initial" | "renewal" | "recovery" | "manual_reactivation" | "upgrade" | "handoff";
};

type Outcome = "paid" | "failed" | "unknown";
type OnvoIntent = {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  confirmationAttempts?: number;
  paymentMethodId?: string | null;
  metadata?: { localReference?: string };
  lastPaymentError?: { code?: string | null; message?: string | null } | null;
  charges?: Array<{ failureCode?: string | null; failureMessage?: string | null }> | null;
};

export class OnvoBillingApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly providerCode: string | null,
    public readonly providerType: string | null,
    public readonly requestId: string | null,
  ) {
    super(`Onvo billing API returned HTTP ${httpStatus}${providerCode ? ` (${providerCode})` : ""}.`);
    this.name = "OnvoBillingApiError";
  }
}

function safeDiagnostic(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : null;
}

async function onvo(secretKey: string, path: string, body?: Record<string, unknown>) {
  const response = await fetch(`https://api.onvopay.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const details = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const nested = details.error && typeof details.error === "object"
      ? details.error as Record<string, unknown> : {};
    throw new OnvoBillingApiError(
      response.status,
      safeDiagnostic(nested.code ?? details.code),
      safeDiagnostic(nested.type ?? details.type),
      safeDiagnostic(response.headers.get("x-request-id")),
    );
  }
  return data as OnvoIntent;
}

function outcomeFor(intent: OnvoIntent): Outcome {
  if (intent.status === "succeeded") return "paid";
  if (["failed", "canceled"].includes(intent.status ?? "")) return "failed";
  // ONVO uses requires_payment_method both before the first confirmation and
  // after a declined confirmation. The initial state is not a card failure.
  if (intent.status === "requires_payment_method"
    && ((intent.confirmationAttempts ?? 0) > 0 || intent.lastPaymentError)) return "failed";
  return "unknown";
}

function verifyIntent(charge: ClaimedSubscriptionCharge, intent: OnvoIntent, expectedId: string) {
  if (intent.id !== expectedId || Number(intent.amount) !== Number(charge.amount_minor)
    || intent.currency !== charge.currency_code
    || intent.metadata?.localReference !== charge.local_reference) {
    throw new Error("ONVO intent does not match the local subscription obligation.");
  }
}

async function saveResult(charge: ClaimedSubscriptionCharge, intent: OnvoIntent, outcome: Outcome) {
  if (!intent.id) throw new Error("Onvo no devolvió el identificador del cobro.");
  const admin = createAdminClient();
  const { data: mapping, error: mappingError } = await admin.schema("mediasis").from("platform_billing_payment_attempts")
    .select("platform_billing_payment_attempt_id").eq("business_subscription_charge_attempt_id", charge.business_subscription_charge_attempt_id).single();
  if (mappingError || !mapping) throw new Error("No se encontró el intento local de facturación.");
  const { data, error } = await admin.schema("mediasis").rpc("finish_onvo_subscription_charge", {
    p_platform_attempt_id: mapping.platform_billing_payment_attempt_id,
    p_intent_id: intent.id,
    p_state: outcome === "paid" ? "succeeded" : outcome === "failed"
      ? intent.status === "canceled" ? "canceled" : "failed"
      : "unknown",
    p_amount_minor: Number(charge.amount_minor),
    p_currency_code: charge.currency_code,
  });
  if (error || !data?.success) throw new Error(error?.message ?? "No se pudo guardar el resultado del cobro.");
  if (outcome === "failed") {
    const failure = classifyOnvoDecline(intent);
    const { error: diagnosticError } = await admin.schema("mediasis").from("platform_billing_payment_attempts")
      .update({ failure_code: failure.code, failure_category: failure.category })
      .eq("platform_billing_payment_attempt_id", mapping.platform_billing_payment_attempt_id);
    if (diagnosticError) console.error("[subscription-billing] decline_diagnostic_failed", { attemptId: mapping.platform_billing_payment_attempt_id, message: diagnosticError.message });
  }
  return data as { duplicate?: boolean };
}

async function notify(charge: ClaimedSubscriptionCharge, outcome: Exclude<Outcome, "unknown">) {
  // Initial trial conversion emails are delivered from the durable lifecycle
  // queue: welcome at trial start and access-paused only after rejection.
  if (charge.kind === "initial") return;
  // The first confirmed failure of each renewal is queued transactionally by
  // the subscription status transition. Sending here could duplicate emails
  // when a webhook and the worker observe the same declined intent.
  if (outcome === "failed" && !["upgrade", "handoff"].includes(charge.kind)) return;
  const admin = createAdminClient();
  const { data: business } = await admin.schema("mediasis").from("businesses").select("full_name").eq("uid", charge.business_id).maybeSingle();
  const event = charge.kind === "upgrade" || charge.kind === "handoff"
    ? outcome === "paid" ? "plan_applied" : "plan_payment_failed"
    : outcome === "paid" ? "recovered" : "failed";
  await sendSubscriptionBillingEmail({ to: charge.cardholder_email, businessName: business?.full_name ?? "tu negocio", event, idempotencyKey: `onvo-subscription-${charge.business_subscription_charge_id}-${event}` });
}

/** A durable local claim is created before this function reaches Onvo. */
export async function processClaimedSubscriptionCharge(charge: ClaimedSubscriptionCharge): Promise<Outcome> {
  const admin = createAdminClient();
  let intent: OnvoIntent | null = null;
  try {
    const { data: mapping, error: mappingError } = await admin.schema("mediasis").from("platform_billing_payment_attempts")
      .select("provider_intent_id").eq("business_subscription_charge_attempt_id", charge.business_subscription_charge_attempt_id).single();
    if (mappingError || !mapping) throw new Error("No se encontró el intento local de facturación.");
    const config = await getOnvoPlatformConfig(admin, charge.business_id);
    if (mapping.provider_intent_id) {
      intent = await onvo(config.secretKey, `/payment-intents/${encodeURIComponent(mapping.provider_intent_id)}`);
    } else {
      intent = await onvo(config.secretKey, "/payment-intents", { amount: Number(charge.amount_minor), currency: charge.currency_code, customerId: charge.customer_id, description: "Suscripción Mediasis", metadata: { localReference: charge.local_reference, businessId: charge.business_id } });
      if (!intent.id) throw new Error("Onvo no devolvió una intención de pago.");
      const { error } = await admin.schema("mediasis").from("platform_billing_payment_attempts")
        .update({ provider_intent_id: intent.id, state: intent.status ?? "creation_unknown", updated_at: new Date().toISOString() })
        .eq("business_subscription_charge_attempt_id", charge.business_subscription_charge_attempt_id).is("provider_intent_id", null);
      if (error) throw error;
      const { error: chargeReferenceError } = await admin.schema("mediasis").from("business_subscription_charges")
        .update({ onvo_intent_id: intent.id })
        .eq("business_subscription_charge_id", charge.business_subscription_charge_id)
        .is("onvo_intent_id", null);
      if (chargeReferenceError) console.error("[subscription-billing] charge_intent_reference_failed", {
        chargeId: charge.business_subscription_charge_id, message: chargeReferenceError.message,
      });
      intent = await onvo(config.publishableKey, `/payment-intents/${encodeURIComponent(intent.id)}/confirm`, { paymentMethodId: charge.payment_method_id });
    }
    // The order app uses an API lookup as the source of truth after
    // confirmation; do not grant access from an unverified response alone.
    intent = await onvo(config.secretKey, `/payment-intents/${encodeURIComponent(intent.id!)}`);
    verifyIntent(charge, intent, mapping.provider_intent_id ?? intent.id!);
    const outcome = outcomeFor(intent);
    const saved = await saveResult(charge, intent, outcome);
    if (!saved.duplicate && outcome !== "unknown") await notify(charge, outcome).catch(() => undefined);
    return outcome;
  } catch (error) {
    if (intent?.id) {
      // A declined confirmation can be returned as HTTP 4xx. Read the same
      // intent before deciding whether it was rejected or remains uncertain.
      if (error instanceof OnvoBillingApiError) {
        try {
          const config = await getOnvoPlatformConfig(admin, charge.business_id);
          const verified = await onvo(config.secretKey, `/payment-intents/${encodeURIComponent(intent.id)}`);
          if (verified.id === intent.id) {
            verifyIntent(charge, verified, intent.id);
            const outcome = outcomeFor(verified);
            const saved = await saveResult(charge, verified, outcome);
            if (!saved.duplicate && outcome !== "unknown") await notify(charge, outcome).catch(() => undefined);
            if (outcome !== "unknown") return outcome;
          }
        } catch {
          // Preserve the original API error; reconciliation can inspect the
          // already-associated intent without creating another charge.
        }
      }
      await saveResult(charge, intent, "unknown").catch(() => undefined);
    }
    throw error;
  }
}

/** Webhooks are authoritative; this only recovers an event that did not arrive. */
export async function reconcileUnknownSubscriptionCharges(limit = 20) {
  const admin = createAdminClient();
  const { data: mappings, error: mappingsError } = await admin.schema("mediasis")
    .from("platform_billing_payment_attempts")
    .select("platform_billing_payment_attempt_id,business_id,business_subscription_charge_attempt_id,local_reference,provider_intent_id,provider_payment_method_id,amount_minor,currency_code,state,last_checked_at,created_at")
    .eq("purpose", "subscription")
    .in("state", ["creation_unknown", "requires_payment_method", "processing", "requires_action", "unknown"])
    .not("provider_intent_id", "is", null).order("created_at", { ascending: true }).limit(limit);
  if (mappingsError) throw mappingsError;
  let resolved = 0;
  for (const mapping of mappings ?? []) {
    try {
      const intentId = mapping.provider_intent_id;
      if (!intentId) continue;
      const [{ data: attempt, error: attemptError }, { data: card, error: cardError }] = await Promise.all([
        admin.schema("mediasis").from("business_subscription_charge_attempts")
          .select("business_subscription_charge_id,status")
          .eq("business_subscription_charge_attempt_id", mapping.business_subscription_charge_attempt_id).maybeSingle(),
        admin.schema("mediasis").from("platform_billing_cards")
          .select("provider_customer_id,cardholder_email,active,recurring_consent_at")
          .eq("business_id", mapping.business_id)
          .eq("provider_payment_method_id", mapping.provider_payment_method_id).maybeSingle(),
      ]);
      if (attemptError || cardError || !attempt || !card) throw attemptError ?? cardError ?? new Error("Missing local charge or card");
      const { data: chargeRow, error: chargeError } = await admin.schema("mediasis")
        .from("business_subscription_charges").select("kind,status,business_id")
        .eq("business_subscription_charge_id", attempt.business_subscription_charge_id).maybeSingle();
      if (chargeError || !chargeRow || chargeRow.business_id !== mapping.business_id) throw chargeError ?? new Error("Charge mapping mismatch");
      if (!["processing", "unknown"].includes(chargeRow.status)
        || !["claimed", "unknown"].includes(attempt.status)) continue;
      const charge: ClaimedSubscriptionCharge = {
        business_subscription_charge_id: attempt.business_subscription_charge_id,
        business_subscription_charge_attempt_id: mapping.business_subscription_charge_attempt_id,
        business_id: mapping.business_id,
        local_reference: mapping.local_reference,
        amount_minor: Number(mapping.amount_minor),
        currency_code: mapping.currency_code,
        customer_id: card.provider_customer_id,
        payment_method_id: mapping.provider_payment_method_id,
        cardholder_email: card.cardholder_email,
        kind: chargeRow.kind,
      };
      const config = await getOnvoPlatformConfig(admin, mapping.business_id);
      let intent = await onvo(config.secretKey, `/payment-intents/${encodeURIComponent(intentId)}`);
      verifyIntent(charge, intent, intentId);
      let outcome = outcomeFor(intent);
      if (outcome === "unknown" && intent.status === "requires_payment_method"
        && intent.confirmationAttempts === 0 && !intent.paymentMethodId
        && !mapping.last_checked_at && card.active && card.recurring_consent_at
        && Date.now() - new Date(mapping.created_at).getTime() > 120_000) {
        // Claim one confirmation of this existing intent. If the network
        // outcome is uncertain, last_checked_at prevents another automatic
        // submission; later runs and webhooks only read its status.
        const { data: claimed, error: claimError } = await admin.schema("mediasis")
          .from("platform_billing_payment_attempts")
          .update({ state: "processing", last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("platform_billing_payment_attempt_id", mapping.platform_billing_payment_attempt_id)
          .in("state", ["creation_unknown", "requires_payment_method", "unknown"])
          .is("last_checked_at", null)
          .select("platform_billing_payment_attempt_id").maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) continue;
        try {
          intent = await onvo(config.publishableKey, `/payment-intents/${encodeURIComponent(intentId)}/confirm`, {
            paymentMethodId: mapping.provider_payment_method_id,
          });
        } catch (confirmError) {
          intent = await onvo(config.secretKey, `/payment-intents/${encodeURIComponent(intentId)}`);
          if (outcomeFor(intent) === "unknown") throw confirmError;
        }
        outcome = outcomeFor(intent);
      }
      if (outcome === "unknown") continue;
      const saved = await saveResult(charge, intent, outcome);
      if (!saved.duplicate) await notify(charge, outcome).catch(() => undefined);
      resolved++;
    } catch (error) {
      console.error("[subscription-billing] reconcile_attempt_failed", {
        attemptId: mapping.business_subscription_charge_attempt_id,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return resolved;
}
