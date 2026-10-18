"use server";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { processClaimedCancellationFee, verifyCancellationFeeIntent, type ClaimedCancellationFee } from "@/lib/dashboard/cancellation-fee-runner";
import { declineMessage, type BillingDeclineCategory } from "@/lib/onvo/billing-decline";
import { getOnvoPlatformConfig } from "@/lib/onvo/platform-billing";
import { createAdminClient } from "@/lib/supabase/admin";

export type CancellationFeeStatus = {
  status: "scheduled" | "processing" | "action_required" | "unknown" | "paid" | "failed";
  message: string;
  amountMinor?: number;
  currencyCode?: string;
  paymentIntentId?: string;
  publishableKey?: string;
};

async function owner(businessId: string) {
  const context = await getDashboardAuthorizationContext();
  if (context?.mode !== "clerk" || context.activeBusinessId !== businessId || !context.appUserId) {
    throw new Error("Seleccioná el negocio y entrá como propietario.");
  }
  const admin = createAdminClient();
  const { data: accountOwner } = await admin.schema("mediasis").from("business_account_owners")
    .select("owner_app_user_id").eq("business_id", businessId).maybeSingle();
  if (accountOwner?.owner_app_user_id !== context.appUserId) throw new Error("Solo el propietario puede liquidar el cargo final.");
  return { admin, ownerId: context.appUserId };
}

export async function getCancellationFeeStatus(businessId: string): Promise<CancellationFeeStatus> {
  try {
    const { admin } = await owner(businessId);
    const { data: fee, error } = await admin.schema("mediasis").from("business_cancellation_fees")
      .select("cancellation_fee_id,status,amount_minor,currency_code,due_at")
      .eq("business_id", businessId).neq("status", "waived")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !fee) throw new Error("No se encontró un cargo final pendiente.");
    const base = { amountMinor: Number(fee.amount_minor), currencyCode: fee.currency_code };
    if (fee.status === "paid") return { ...base, status: "paid", message: "Cargo final pagado. Tu suscripción sigue cancelada." };
    const { data: attempt } = await admin.schema("mediasis").from("business_cancellation_fee_attempts")
      .select("cancellation_fee_attempt_id,local_reference,provider_intent_id,provider_payment_method_id,customer_id,amount_minor,currency_code,state,failure_category")
      .eq("cancellation_fee_id", fee.cancellation_fee_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (attempt?.provider_intent_id && !["succeeded", "failed", "canceled"].includes(attempt.state)) {
      try {
        const config = await getOnvoPlatformConfig(admin, businessId);
        const verified = await verifyCancellationFeeIntent({
          cancellation_fee_attempt_id: attempt.cancellation_fee_attempt_id, business_id: businessId,
          local_reference: attempt.local_reference, amount_minor: Number(attempt.amount_minor),
          currency_code: attempt.currency_code, customer_id: attempt.customer_id,
          payment_method_id: attempt.provider_payment_method_id,
        }, attempt.provider_intent_id, config.secretKey);
        if (verified.state === "succeeded") return { ...base, status: "paid", message: "Cargo final pagado. Tu suscripción sigue cancelada." };
        if (verified.state === "failed" || verified.state === "canceled") return {
          ...base, status: "failed", message: declineMessage(verified.failure?.category ?? "unknown"),
        };
        if (verified.state === "requires_action") return { ...base, status: "action_required",
          message: "Tu banco necesita verificar este cargo final.", paymentIntentId: attempt.provider_intent_id,
          publishableKey: config.publishableKey };
      } catch { return { ...base, status: "unknown", message: "No pudimos verificar el mismo intento en Onvo. No inicies otro pago todavía." }; }
    }
    if (fee.status === "failed") return { ...base, status: "failed",
      message: declineMessage((attempt?.failure_category as BillingDeclineCategory | null) ?? "unknown") };
    if (fee.status === "unknown" || attempt?.state === "creation_unknown") return { ...base, status: "unknown",
      message: "El resultado está pendiente de conciliación. No se iniciará otro cargo." };
    if (fee.status === "scheduled" && new Date(fee.due_at).getTime() > Date.now()) return { ...base, status: "scheduled",
      message: "El cargo final está programado para el fin de tu período pagado." };
    return { ...base, status: "processing", message: "Estamos verificando el cargo final. Podés actualizar el estado sin crear otro intento." };
  } catch (error) { return { status: "unknown", message: error instanceof Error ? error.message : "No se pudo consultar el cargo final." }; }
}

export async function payCancellationFee(businessId: string): Promise<CancellationFeeStatus> {
  try {
    const current = await getCancellationFeeStatus(businessId);
    if (!["failed", "processing"].includes(current.status)) return current;
    const { admin, ownerId } = await owner(businessId);
    const { data, error } = await admin.schema("mediasis").rpc("claim_onvo_cancellation_fee", {
      p_business_id: businessId, p_owner_app_user_id: ownerId,
    });
    if (error) throw error;
    if (data?.length) await processClaimedCancellationFee(data[0] as ClaimedCancellationFee);
    return getCancellationFeeStatus(businessId);
  } catch (error) { return { status: "unknown", message: error instanceof Error ? error.message : "No se pudo iniciar el cargo final." }; }
}
