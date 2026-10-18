"use server";

import { randomUUID } from "node:crypto";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { processClaimedSubscriptionCharge, type ClaimedSubscriptionCharge } from "@/lib/dashboard/subscription-charge-runner";
import { declineMessage, type BillingDeclineCategory, classifyOnvoDecline } from "@/lib/onvo/billing-decline";
import { getOnvoPlatformConfig } from "@/lib/onvo/platform-billing";
import { createAdminClient } from "@/lib/supabase/admin";

export type RecoveryStatus = {
  status: "action_required" | "processing" | "paid" | "rejected" | "unknown";
  message: string;
  paymentIntentId?: string;
  publishableKey?: string;
  attemptsRemaining?: number;
  retryAt?: string;
};

async function ownerContext(businessId: string) {
  const context = await getDashboardAuthorizationContext();
  if (!context?.appUserId || context.activeBusinessId !== businessId || context.mode !== "clerk") {
    throw new Error("Seleccioná el negocio y entrá como propietario para continuar.");
  }
  const admin = createAdminClient();
  const { data: owner, error } = await admin.schema("mediasis").from("business_account_owners")
    .select("owner_app_user_id").eq("business_id", businessId).maybeSingle();
  if (error || owner?.owner_app_user_id !== context.appUserId) {
    throw new Error("Solo el propietario del negocio puede completar este pago.");
  }
  return { admin, appUserId: context.appUserId };
}

async function inspectPending(businessId: string): Promise<RecoveryStatus | null> {
  const { admin } = await ownerContext(businessId);
  const { data: subscription, error: subscriptionError } = await admin.schema("mediasis")
    .from("business_subscriptions").select("status").eq("business_id", businessId).maybeSingle();
  if (subscriptionError) throw new Error("No se pudo consultar la suscripción.");
  const { data: charge, error: chargeError } = await admin.schema("mediasis")
    .from("business_subscription_charges").select("business_subscription_charge_id,status")
    .eq("business_id", businessId).in("status", ["processing", "unknown"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (chargeError) throw new Error("No se pudo consultar el cobro pendiente.");
  if (!charge) return subscription?.status === "active"
    ? { status: "paid", message: "El pago está confirmado y el acceso ya está activo." } : null;

  const { data: attempt, error: attemptError } = await admin.schema("mediasis")
    .from("business_subscription_charge_attempts")
    .select("business_subscription_charge_attempt_id")
    .eq("business_subscription_charge_id", charge.business_subscription_charge_id)
    .order("requested_at", { ascending: false }).limit(1).maybeSingle();
  if (attemptError || !attempt) return { status: "processing", message: "Estamos preparando el cobro. Volvé a consultar en unos momentos." };
  const { data: mapping, error: mappingError } = await admin.schema("mediasis")
    .from("platform_billing_payment_attempts")
    .select("platform_billing_payment_attempt_id,provider_intent_id,local_reference,amount_minor,currency_code,provider_payment_method_id")
    .eq("business_id", businessId).eq("purpose", "subscription")
    .eq("business_subscription_charge_attempt_id", attempt.business_subscription_charge_attempt_id).maybeSingle();
  if (mappingError || !mapping?.provider_intent_id) return { status: "processing", message: "Estamos preparando el cobro. Volvé a consultar en unos momentos." };

  const config = await getOnvoPlatformConfig(admin, businessId);
  let intent: { id?: string; status?: string; amount?: number; currency?: string; paymentMethodId?: string; confirmationAttempts?: number; lastPaymentError?: { code?: string; message?: string }; charges?: Array<{ failureCode?: string; failureMessage?: string }>; metadata?: { localReference?: string } };
  try {
    const response = await fetch(`https://api.onvopay.com/v1/payment-intents/${encodeURIComponent(mapping.provider_intent_id)}`, {
      headers: { Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" }, cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    intent = await response.json();
  } catch {
    return { status: "unknown", message: "No pudimos verificar el estado con Onvo. No vuelvas a iniciar otro pago; intentá consultar de nuevo." };
  }
  if (intent.id !== mapping.provider_intent_id || Number(intent.amount) !== Number(mapping.amount_minor)
    || intent.currency !== mapping.currency_code || intent.metadata?.localReference !== mapping.local_reference
    || (intent.paymentMethodId && mapping.provider_payment_method_id && intent.paymentMethodId !== mapping.provider_payment_method_id)) {
    throw new Error("El cobro de Onvo no coincide con la suscripción de este negocio.");
  }

  if (intent.status === "succeeded" || intent.status === "failed" || intent.status === "canceled"
    || (intent.status === "requires_payment_method" && ((intent.confirmationAttempts ?? 0) > 0 || intent.lastPaymentError))) {
    const state = intent.status === "succeeded" ? "succeeded" : "failed";
    const { error } = await admin.schema("mediasis").rpc("finish_onvo_subscription_charge", {
      p_platform_attempt_id: mapping.platform_billing_payment_attempt_id,
      p_intent_id: mapping.provider_intent_id, p_state: state,
      p_amount_minor: Number(mapping.amount_minor), p_currency_code: mapping.currency_code,
    });
    if (error) throw new Error("No se pudo actualizar el estado del cobro.");
    const failure = classifyOnvoDecline(intent);
    if (state === "failed") await admin.schema("mediasis").from("platform_billing_payment_attempts")
      .update({ failure_code: failure.code, failure_category: failure.category })
      .eq("platform_billing_payment_attempt_id", mapping.platform_billing_payment_attempt_id);
    return state === "succeeded"
      ? { status: "paid", message: "Pago confirmado. Tu negocio ya puede volver a operar." }
      : { status: "rejected", message: declineMessage(failure.category) };
  }
  if (intent.status === "requires_action") return {
    status: "action_required", message: "Tu banco necesita verificar la tarjeta para completar el pago.",
    paymentIntentId: mapping.provider_intent_id, publishableKey: config.publishableKey,
  };
  return { status: "processing", message: "El pago sigue pendiente de confirmación. Podés consultar su estado sin volver a cobrar." };
}

export async function getSubscriptionRecoveryStatus(businessId: string): Promise<RecoveryStatus> {
  try {
    const pending = await inspectPending(businessId);
    if (pending) return pending;
    const { admin, appUserId } = await ownerContext(businessId);
    const [{ data: failed }, { data: submissions }, { data: cooldown }] = await Promise.all([
      admin.schema("mediasis").from("platform_billing_payment_attempts")
        .select("platform_billing_payment_attempt_id,provider_intent_id,local_reference,amount_minor,currency_code,failure_category")
        .eq("business_id", businessId).eq("purpose", "subscription").eq("state", "failed")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.schema("mediasis").from("platform_billing_owner_submissions").select("created_at")
        .eq("owner_app_user_id", appUserId).gte("created_at", new Date(Date.now() - 3_600_000).toISOString())
        .order("created_at", { ascending: false }).limit(5),
      admin.schema("mediasis").from("platform_billing_owner_cooldowns").select("blocked_until")
        .eq("owner_app_user_id", appUserId).maybeSingle(),
    ]);
    const blocked = Boolean(cooldown?.blocked_until && new Date(cooldown.blocked_until).getTime() > Date.now());
    const remaining = blocked ? 0 : Math.max(0, 5 - (submissions?.length ?? 0));
    const retryAt = blocked ? cooldown?.blocked_until : undefined;
    let failureCategory = (failed?.failure_category as BillingDeclineCategory | null) ?? "unknown";
    if (failed?.provider_intent_id && !failed.failure_category) {
      try {
        const config = await getOnvoPlatformConfig(admin, businessId);
        const response = await fetch(`https://api.onvopay.com/v1/payment-intents/${encodeURIComponent(failed.provider_intent_id)}`, {
          headers: { Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" }, cache: "no-store",
        });
        if (response.ok) {
          const intent = await response.json();
          if (intent.id === failed.provider_intent_id && Number(intent.amount) === Number(failed.amount_minor)
            && intent.currency === failed.currency_code && intent.metadata?.localReference === failed.local_reference) {
            const detail = classifyOnvoDecline(intent);
            failureCategory = detail.category;
            await admin.schema("mediasis").from("platform_billing_payment_attempts")
              .update({ failure_category: detail.category, failure_code: detail.code })
              .eq("platform_billing_payment_attempt_id", failed.platform_billing_payment_attempt_id);
          }
        }
      } catch { /* Keep the safe generic message if Onvo cannot be reached. */ }
    }
    return failed ? { status: "rejected", message: declineMessage(failureCategory), attemptsRemaining: remaining, retryAt }
      : { status: "processing", message: "Todavía no hay un cobro pendiente. Presioná Pagar y reactivar para solicitarlo.", attemptsRemaining: remaining, retryAt };
  } catch (error) {
    return { status: "unknown", message: error instanceof Error ? error.message : "No se pudo verificar el pago." };
  }
}

export async function requestSubscriptionRecovery(businessId: string): Promise<RecoveryStatus> {
  try {
    const existing = await inspectPending(businessId);
    if (existing) return existing;
    const { admin, appUserId } = await ownerContext(businessId);
    const { data: failedCharge } = await admin.schema("mediasis").from("business_subscription_charges")
      .select("business_subscription_charge_id").eq("business_id", businessId)
      .eq("processor", "onvo").eq("status", "failed")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!failedCharge) {
      const { data, error } = await admin.schema("mediasis").rpc("request_onvo_business_subscription_payment", {
        p_owner_app_user_id: appUserId, p_business_id: businessId,
      });
      if (error || !data?.success) throw new Error(error?.message ?? "No se pudo solicitar el pago.");
      return { status: "processing", message: "Solicitamos el cobro. Consultá su estado en unos momentos; no lo envíes otra vez." };
    }
    const { data: claimed, error } = await admin.schema("mediasis").rpc("claim_onvo_failed_subscription_retry", {
      p_owner_app_user_id: appUserId, p_business_id: businessId, p_submission_key: randomUUID(),
    });
    if (error) throw new Error(error.message);
    const rawClaim = claimed?.[0] as (ClaimedSubscriptionCharge | { kind: "rate_limited" }) | undefined;
    if (!rawClaim) throw new Error("No hay un cobro rechazado para reintentar.");
    if (rawClaim.kind === "rate_limited") return await getSubscriptionRecoveryStatus(businessId);
    const charge = rawClaim as ClaimedSubscriptionCharge;
    try { await processClaimedSubscriptionCharge(charge); }
    catch (processingError) { console.error("[subscription-recovery] retry_processing_failed", { businessId, attemptId: charge.business_subscription_charge_attempt_id, message: processingError instanceof Error ? processingError.message : "unknown" }); }
    return await getSubscriptionRecoveryStatus(businessId);
  } catch (error) {
    return { status: "unknown", message: error instanceof Error ? error.message : "No se pudo solicitar el pago." };
  }
}
