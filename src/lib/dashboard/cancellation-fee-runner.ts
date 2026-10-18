import "server-only";

import { classifyOnvoDecline } from "@/lib/onvo/billing-decline";
import { getOnvoPlatformConfig } from "@/lib/onvo/platform-billing";
import { createAdminClient } from "@/lib/supabase/admin";

export type ClaimedCancellationFee = {
  cancellation_fee_attempt_id: string;
  business_id: string;
  local_reference: string;
  amount_minor: number;
  currency_code: string;
  customer_id: string;
  payment_method_id: string;
};

type FeeIntent = {
  id?: string; status?: string; amount?: number; currency?: string;
  paymentMethodId?: string | null; confirmationAttempts?: number;
  metadata?: { localReference?: string };
  lastPaymentError?: { code?: string; message?: string } | null;
  charges?: Array<{ failureCode?: string; failureMessage?: string }> | null;
};

async function api(key: string, path: string, body?: Record<string, unknown>): Promise<FeeIntent> {
  const response = await fetch(`https://api.onvopay.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, cache: "no-store",
  });
  const intent = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Onvo devolvió HTTP ${response.status} al procesar el cargo final.`);
  return intent as FeeIntent;
}

function verifiedState(intent: FeeIntent, attempt: ClaimedCancellationFee, intentId: string) {
  if (intent.id !== intentId || Number(intent.amount) !== Number(attempt.amount_minor)
    || intent.currency !== attempt.currency_code || intent.metadata?.localReference !== attempt.local_reference
    || (intent.paymentMethodId && intent.paymentMethodId !== attempt.payment_method_id)) {
    throw new Error("El cargo final de Onvo no coincide con la obligación local.");
  }
  if (intent.status === "succeeded") return "succeeded";
  if (intent.status === "failed" || intent.status === "canceled") return intent.status;
  if (intent.status === "requires_payment_method" && ((intent.confirmationAttempts ?? 0) > 0 || intent.lastPaymentError)) return "failed";
  if (intent.status === "requires_action") return "requires_action";
  return "unknown";
}

export async function verifyCancellationFeeIntent(attempt: ClaimedCancellationFee, intentId: string, secretKey: string) {
  const admin = createAdminClient();
  const intent = await api(secretKey, `/payment-intents/${encodeURIComponent(intentId)}`);
  const state = verifiedState(intent, attempt, intentId);
  const { data, error } = await admin.schema("mediasis").rpc("finish_onvo_cancellation_fee", {
    p_attempt_id: attempt.cancellation_fee_attempt_id, p_intent_id: intentId,
    p_state: state, p_amount_minor: Number(attempt.amount_minor), p_currency_code: attempt.currency_code,
  });
  if (error || !data?.success) throw new Error(error?.message ?? "No se pudo guardar el estado del cargo final.");
  if (state === "failed" || state === "canceled") {
    const failure = classifyOnvoDecline(intent);
    await admin.schema("mediasis").from("business_cancellation_fee_attempts")
      .update({ failure_category: failure.category, failure_code: failure.code })
      .eq("cancellation_fee_attempt_id", attempt.cancellation_fee_attempt_id);
  }
  return { state, intentId, failure: state === "failed" || state === "canceled" ? classifyOnvoDecline(intent) : null };
}

export async function processClaimedCancellationFee(attempt: ClaimedCancellationFee) {
  const admin = createAdminClient();
  const config = await getOnvoPlatformConfig(admin, attempt.business_id);
  let intentId: string | null = null;
  let intentAssociated = false;
  try {
    const created = await api(config.secretKey, "/payment-intents", {
      amount: Number(attempt.amount_minor), currency: attempt.currency_code,
      customerId: attempt.customer_id, description: "Cargo final de cancelación Mediasis",
      metadata: { localReference: attempt.local_reference, businessId: attempt.business_id, purpose: "cancellation_fee" },
    });
    if (!created.id) throw new Error("Onvo no devolvió el ID del cargo final.");
    intentId = created.id;
    const { data: saved, error: saveError } = await admin.schema("mediasis").from("business_cancellation_fee_attempts")
      .update({ provider_intent_id: intentId, state: "processing" })
      .eq("cancellation_fee_attempt_id", attempt.cancellation_fee_attempt_id).is("provider_intent_id", null)
      .select("cancellation_fee_attempt_id").maybeSingle();
    if (saveError || !saved) throw new Error("No se pudo asociar el intento de Onvo al cargo final.");
    intentAssociated = true;
    await api(config.publishableKey, `/payment-intents/${encodeURIComponent(intentId)}/confirm`, {
      paymentMethodId: attempt.payment_method_id,
    });
  } catch (error) {
    if (!intentId || !intentAssociated) {
      // An unknown creation result may already have charged at Onvo. Hold for
      // staff reconciliation by local reference; never create another intent.
      await admin.schema("mediasis").from("business_cancellation_fee_attempts")
        .update({ state: "creation_unknown" }).eq("cancellation_fee_attempt_id", attempt.cancellation_fee_attempt_id);
      await admin.schema("mediasis").from("business_cancellation_fees")
        .update({ status: "unknown" }).eq("business_id", attempt.business_id).eq("status", "processing");
      throw error;
    }
    // A decline can be a 4xx confirmation response. The verified intent is
    // the only source of truth before notifying or allowing another attempt.
    console.info("[cancellation-fee] confirmation_needs_lookup", { attemptId: attempt.cancellation_fee_attempt_id });
  }
  return verifyCancellationFeeIntent(attempt, intentId!, config.secretKey);
}

export async function processDueCancellationFee() {
  const admin = createAdminClient();
  const { data, error } = await admin.schema("mediasis").rpc("claim_onvo_cancellation_fee", {
    p_business_id: null, p_owner_app_user_id: null,
  });
  if (error) throw error;
  if (!data?.length) return 0;
  await processClaimedCancellationFee(data[0] as ClaimedCancellationFee);
  return 1;
}

export async function reconcileCancellationFees() {
  const admin = createAdminClient();
  const { data, error } = await admin.schema("mediasis").from("business_cancellation_fee_attempts")
    .select("cancellation_fee_attempt_id,local_reference,provider_intent_id,provider_payment_method_id,customer_id,amount_minor,currency_code,business_cancellation_fees!inner(business_id)")
    .in("state", ["processing", "requires_action", "unknown"]).not("provider_intent_id", "is", null)
    .order("created_at").limit(10);
  if (error) throw error;
  for (const row of data ?? []) {
    const fee = Array.isArray(row.business_cancellation_fees) ? row.business_cancellation_fees[0] : row.business_cancellation_fees;
    if (!fee?.business_id || !row.provider_intent_id) continue;
    try {
      const config = await getOnvoPlatformConfig(admin, fee.business_id);
      await verifyCancellationFeeIntent({
        cancellation_fee_attempt_id: row.cancellation_fee_attempt_id, business_id: fee.business_id,
        local_reference: row.local_reference, amount_minor: Number(row.amount_minor), currency_code: row.currency_code,
        customer_id: row.customer_id, payment_method_id: row.provider_payment_method_id,
      }, row.provider_intent_id, config.secretKey);
    } catch (failure) {
      console.error("[cancellation-fee] reconcile_failed", { attemptId: row.cancellation_fee_attempt_id,
        message: failure instanceof Error ? failure.message : "unknown" });
    }
  }
}
