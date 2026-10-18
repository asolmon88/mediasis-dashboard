import { NextResponse } from "next/server";

import { OnvoBillingApiError, processClaimedSubscriptionCharge, reconcileUnknownSubscriptionCharges, type ClaimedSubscriptionCharge } from "@/lib/dashboard/subscription-charge-runner";
import { processDueCancellationFee, reconcileCancellationFees } from "@/lib/dashboard/cancellation-fee-runner";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorSummary(error: unknown) {
  if (error instanceof OnvoBillingApiError) return {
    message: error.message,
    httpStatus: error.httpStatus,
    providerCode: error.providerCode,
    providerType: error.providerType,
    requestId: error.requestId,
  };
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown; hint?: unknown };
    return {
      code: typeof value.code === "string" ? value.code : undefined,
      message: typeof value.message === "string" ? value.message : "Unknown error",
      hint: typeof value.hint === "string" ? value.hint : undefined,
    };
  }
  return { message: String(error) };
}

function rpcErrorSummary(error: { code?: string; message: string; hint?: string }) {
  return { code: error.code ?? null, message: error.message, hint: error.hint ?? null };
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("Unauthorized", { status: 401 });
  const runId = crypto.randomUUID();
  console.info("[subscription-billing] run_started", { runId });
  let stage = "initialize";
  try {
    const admin = createAdminClient();
    stage = "reconcile_unknown";
    const reconciled = await reconcileUnknownSubscriptionCharges();
    await reconcileCancellationFees();
    stage = "claim_charges";
    const [{ data: due, error: dueError }, { data: upgrades, error: upgradeError }] = await Promise.all([
      admin.schema("mediasis").rpc("claim_onvo_due_subscription_charges", { p_limit: 10 }),
      admin.schema("mediasis").rpc("claim_onvo_pending_subscription_upgrades", { p_limit: 10 }),
    ]);
    if (dueError || upgradeError) {
      if (dueError) console.error(`[subscription-billing] claim_due_failed ${JSON.stringify({ runId, ...rpcErrorSummary(dueError) })}`);
      if (upgradeError) console.error(`[subscription-billing] claim_upgrades_failed ${JSON.stringify({ runId, ...rpcErrorSummary(upgradeError) })}`);
      return NextResponse.json({
        error: "Could not claim subscription charges",
        runId,
        claimErrors: {
          due: dueError ? rpcErrorSummary(dueError) : null,
          upgrades: upgradeError ? rpcErrorSummary(upgradeError) : null,
        },
      }, { status: 500 });
    }
    const claimed = [...(due ?? []), ...(upgrades ?? [])] as ClaimedSubscriptionCharge[];
    stage = "process_charges";
    const results = await Promise.allSettled(claimed.map(processClaimedSubscriptionCharge));
    let paid = 0;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        if (result.value === "paid") paid++;
      } else {
        const charge = claimed[index];
        console.error("[subscription-billing] charge_processing_failed", {
          runId,
          businessId: charge.business_id,
          chargeId: charge.business_subscription_charge_id,
          attemptId: charge.business_subscription_charge_attempt_id,
          error: errorSummary(result.reason),
        });
      }
    });
    stage = "expire_access";
    const { data: suspended, error: suspendError } = await admin.schema("mediasis").rpc("expire_due_subscription_access");
    if (suspendError) console.error("[subscription-billing] expire_access_failed", { runId, error: errorSummary(suspendError) });
    stage = "cancellation_fee";
    let cancellationFeesClaimed = 0;
    try { cancellationFeesClaimed = await processDueCancellationFee(); }
    catch (feeError) { console.error("[subscription-billing] cancellation_fee_failed", { runId, error: errorSummary(feeError) }); }
    console.info("[subscription-billing] run_completed", { runId, claimed: claimed.length, paid, reconciled, suspended: suspended ?? 0, cancellationFeesClaimed });
    return NextResponse.json({ claimed: claimed.length, paid, reconciled, suspended: suspended ?? 0, cancellationFeesClaimed, runId });
  } catch (error) {
    console.error("[subscription-billing] run_failed", { runId, stage, error: errorSummary(error) });
    return NextResponse.json({ error: "Subscription billing failed", runId }, { status: 500 });
  }
}
