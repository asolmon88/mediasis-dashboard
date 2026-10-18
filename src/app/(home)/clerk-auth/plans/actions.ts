"use server";

import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";

import { synchronizeClerkIdentity } from "@/lib/dashboard/auth";
import { getPublicSignupCatalog } from "@/lib/dashboard/merchant-onboarding";
import { createAdminClient } from "@/lib/supabase/admin";

export async function beginBusinessOnboardingFromPlans(input: {
  planKey: "lite" | "basic";
  countryCode: string;
  billingCadence: "monthly" | "annual";
}) {
  const session = await auth();
  if (!session.userId) throw new Error("Iniciá sesión para crear tu negocio.");
  if (!(["lite", "basic"] as string[]).includes(input.planKey) || !(["monthly", "annual"] as string[]).includes(input.billingCadence)) {
    throw new Error("Elegí un plan y una frecuencia válidos.");
  }
  await synchronizeClerkIdentity(session.userId);
  const admin = createAdminClient();
  const { data: user, error: userError } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id").eq("clerk_user_id", session.userId).single();
  if (userError || !user) throw new Error("No se pudo identificar tu cuenta.");

  const { count, error: businessError } = await admin.schema("mediasis").from("business_memberships")
    .select("business_id,businesses!inner(active)", { count: "exact", head: true })
    .eq("app_user_id", user.app_user_id).eq("status", "active").is("revoked_at", null).eq("businesses.active", true);
  if (businessError) throw new Error("No se pudo verificar tus negocios.");
  if ((count ?? 0) > 0) throw new Error("Ya tenés un negocio activo. Creá los negocios adicionales desde tu panel.");

  const catalog = await getPublicSignupCatalog();
  const country = catalog.countries.find((item) => item.countryCode === input.countryCode);
  const plan = catalog.plans.find((item) => item.key === input.planKey);
  const currencyCode = plan?.billingCurrencyCode ?? country?.currencyCode;
  const price = currencyCode ? plan?.prices[currencyCode] : null;
  const amount = input.billingCadence === "annual" ? price?.annualMinor : price?.monthlyMinor;
  if (!country || !plan || !currencyCode || amount == null) throw new Error("El país o plan seleccionado ya no está disponible.");

  const idempotencyKey = randomUUID();
  const values = {
    country_code: country.countryCode,
    subscription_plan_id: plan.id,
    billing_cadence: input.billingCadence,
    offered_currency_code: currencyCode,
    offered_fixed_fee_minor: amount,
    offer_price_source: "catalog_backfill",
    provisioning_idempotency_key: idempotencyKey,
    status: "onboarding",
    current_step: "business_setup",
    business_id: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  };
  const { data: existing, error: existingError } = await admin.schema("mediasis").from("merchant_onboarding")
    .select("status,current_step,business_id").eq("app_user_id", user.app_user_id).maybeSingle();
  if (existingError) throw new Error("No se pudo preparar el registro de tu negocio.");
  if (existing?.status === "onboarding" && existing.business_id == null && existing.current_step === "business_setup") {
    const { error } = await admin.schema("mediasis").from("merchant_onboarding").update(values).eq("app_user_id", user.app_user_id);
    if (error) throw new Error("No se pudo actualizar tu selección de plan.");
  } else if (existing) {
    // There is no active business at this point. Reusing the single current
    // onboarding record lets an order-app-only account, or a previously
    // deleted owner, start a fresh business without inheriting old dates.
    const { error } = await admin.schema("mediasis").from("merchant_onboarding").update(values).eq("app_user_id", user.app_user_id);
    if (error) throw new Error("No se pudo iniciar la creación de tu nuevo negocio.");
  } else {
    const { error } = await admin.schema("mediasis").from("merchant_onboarding").insert({ app_user_id: user.app_user_id, ...values });
    if (error) throw new Error("No se pudo guardar el plan seleccionado.");
  }
  return { success: true as const };
}
