import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { planIncludesFeature } from "@/lib/plan-features";

export async function getBusinessPlanEntitlements(businessId: string, admin = createAdminClient()) {
  // Do not use PostgREST's embedded relationship here. A stale schema cache can
  // temporarily omit that relation even while both tables and their rows exist.
  const { data: assignment, error: assignmentError } = await admin
    .schema("mediasis")
    .from("business_plan_assignments")
    .select("subscription_plan_id")
    .eq("business_id", businessId)
    .maybeSingle();
  if (assignmentError) throw new Error("No se pudo verificar el plan del negocio.");

  let planKey: string | null = null;
  if (assignment?.subscription_plan_id) {
    const { data: plan, error: planError } = await admin
      .schema("mediasis")
      .from("subscription_plans")
      .select("stable_key")
      .eq("subscription_plan_id", assignment.subscription_plan_id)
      .maybeSingle();
    if (planError) throw new Error("No se pudo verificar el plan del negocio.");
    planKey = plan?.stable_key ?? null;
  }

  return {
    planKey,
    cashback: planIncludesFeature(planKey, "cashback"),
    metaPixel: planIncludesFeature(planKey, "meta_pixel"),
    uberDelivery: planIncludesFeature(planKey, "uber_delivery"),
  };
}
