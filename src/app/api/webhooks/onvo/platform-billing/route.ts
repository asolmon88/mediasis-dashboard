import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { classifyOnvoDecline } from "@/lib/onvo/billing-decline";
import { verifyCancellationFeeIntent } from "@/lib/dashboard/cancellation-fee-runner";

export const runtime = "nodejs";

type OnvoEvent = { type?: string; data?: { id?: string; error?: { code?: string; message?: string } }; error?: { code?: string; message?: string } };
type OnvoIntent = { id?: string; status?: string; amount?: number; currency?: string; metadata?: { localReference?: string }; lastPaymentError?: { code?: string; message?: string }; charges?: Array<{ failureCode?: string; failureMessage?: string }> };

function matches(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const suppliedSecret = request.headers.get("x-webhook-secret") ?? "";
  const raw = await request.text();
  if (!suppliedSecret || raw.length > 256_000) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: configs, error: configError } = await admin.schema("mediasis")
    .from("onvo_marketplace_platform_configs")
    .select("country_code,secret_key,platform_billing_webhook_secret")
    .eq("enabled", true).eq("platform_billing_enabled", true)
    .not("platform_billing_webhook_secret", "is", null);
  if (configError) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const config = (configs ?? []).find((row) =>
    row.platform_billing_webhook_secret && matches(suppliedSecret, row.platform_billing_webhook_secret));
  if (!config) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let event: OnvoEvent;
  try { event = JSON.parse(raw) as OnvoEvent; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!event.type?.startsWith("payment-intent.") || typeof event.data?.id !== "string") {
    return NextResponse.json({ received: true });
  }
  const intentId = event.data.id;
  const { data: mapping, error: mappingError } = await admin.schema("mediasis")
    .from("platform_billing_payment_attempts")
    .select("platform_billing_payment_attempt_id,business_id,purpose,local_reference,provider_intent_id,amount_minor,currency_code")
    .eq("provider_intent_id", intentId).maybeSingle();
  if (mappingError) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const { data: feeAttempt, error: feeError } = mapping ? { data: null, error: null } : await admin.schema("mediasis")
    .from("business_cancellation_fee_attempts")
    .select("cancellation_fee_attempt_id,local_reference,provider_payment_method_id,customer_id,amount_minor,currency_code,business_cancellation_fees!inner(business_id)")
    .eq("provider_intent_id", intentId).maybeSingle();
  if (feeError) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  // The primary ONVO account may receive unrelated merchant-order events.
  if (!mapping && !feeAttempt) return NextResponse.json({ received: true });
  const fee = feeAttempt ? (Array.isArray(feeAttempt.business_cancellation_fees)
    ? feeAttempt.business_cancellation_fees[0] : feeAttempt.business_cancellation_fees) : null;
  const billingBusinessId = mapping?.business_id ?? fee?.business_id;
  if (!billingBusinessId) return NextResponse.json({ error: "Unavailable" }, { status: 503 });

  const { data: market, error: marketError } = await admin.schema("mediasis")
    .from("business_market_settings").select("country_code")
    .eq("business_id", billingBusinessId).maybeSingle();
  if (marketError || market?.country_code !== config.country_code) {
    return NextResponse.json({ error: "Market mismatch" }, { status: 503 });
  }

  const digest = createHash("sha256").update(raw).digest("hex");
  const { data: prior, error: priorError } = await admin.schema("mediasis")
    .from("platform_billing_webhook_deliveries").select("processed_at")
    .eq("payload_sha256", digest).maybeSingle();
  if (priorError) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  if (prior?.processed_at) return NextResponse.json({ received: true, duplicate: true });

  const { error: receiptError } = await admin.schema("mediasis")
    .from("platform_billing_webhook_deliveries")
    .upsert({ payload_sha256: digest, event_type: event.type, provider_intent_id: intentId },
      { onConflict: "payload_sha256", ignoreDuplicates: true });
  if (receiptError) return NextResponse.json({ error: "Unavailable" }, { status: 503 });

  try {
    const response = await fetch(`https://api.onvopay.com/v1/payment-intents/${encodeURIComponent(intentId)}`, {
      headers: { Authorization: `Bearer ${config.secret_key}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`ONVO intent lookup returned HTTP ${response.status}`);
    const intent = await response.json() as OnvoIntent;
    if (intent.id !== intentId || Number(intent.amount) !== Number(mapping?.amount_minor ?? feeAttempt?.amount_minor)
      || intent.currency !== (mapping?.currency_code ?? feeAttempt?.currency_code)
      || intent.metadata?.localReference !== (mapping?.local_reference ?? feeAttempt?.local_reference)) {
      throw new Error("ONVO intent does not match the local billing obligation");
    }

    const state = intent.status === "requires_payment_method" && event.type === "payment-intent.failed"
      ? "failed" : intent.status;
    if (!state || !["succeeded", "failed", "canceled", "processing", "requires_action", "authorized"].includes(state)) {
      throw new Error("ONVO intent is not in a reconcilable state");
    }
    if (feeAttempt && fee?.business_id) {
      await verifyCancellationFeeIntent({
        cancellation_fee_attempt_id: feeAttempt.cancellation_fee_attempt_id,
        business_id: fee.business_id, local_reference: feeAttempt.local_reference,
        amount_minor: Number(feeAttempt.amount_minor), currency_code: feeAttempt.currency_code,
        customer_id: feeAttempt.customer_id, payment_method_id: feeAttempt.provider_payment_method_id,
      }, intentId, config.secret_key);
    } else if (mapping?.purpose === "subscription") {
      const { data, error } = await admin.schema("mediasis").rpc("finish_onvo_subscription_charge", {
        p_platform_attempt_id: mapping.platform_billing_payment_attempt_id,
        p_intent_id: intentId,
        p_state: state,
        p_amount_minor: Number(mapping.amount_minor),
        p_currency_code: mapping.currency_code,
      });
      if (error || !data?.success) throw new Error(error?.message ?? "Could not record subscription outcome");
      if (state === "failed") {
        const failure = classifyOnvoDecline(intent, event.data?.error ?? event.error);
        const { error: diagnosticError } = await admin.schema("mediasis").from("platform_billing_payment_attempts")
          .update({ failure_code: failure.code, failure_category: failure.category })
          .eq("platform_billing_payment_attempt_id", mapping.platform_billing_payment_attempt_id);
        if (diagnosticError) throw diagnosticError;
      }
    } else if (mapping?.purpose === "domain") {
      // Domain registration and capture have their own reconciler. A webhook
      // must not fulfill or repeat either step.
      const { error } = await admin.schema("mediasis").from("platform_billing_payment_attempts")
        .update({ state, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("platform_billing_payment_attempt_id", mapping.platform_billing_payment_attempt_id);
      if (error) throw error;
    }
    const { error: finishError } = await admin.schema("mediasis")
      .from("platform_billing_webhook_deliveries")
      .update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq("payload_sha256", digest);
    if (finishError) throw finishError;
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[onvo-platform-billing] reconciliation_failed", {
      intentId, eventType: event.type, message: error instanceof Error ? error.message : "Unknown error",
    });
    await admin.schema("mediasis").from("platform_billing_webhook_deliveries")
      .update({ processing_error: "reconciliation_required" }).eq("payload_sha256", digest);
    return NextResponse.json({ error: "Retry later" }, { status: 503 });
  }
}
