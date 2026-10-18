import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";

import { clerkAuthenticationEnabledForRequest } from "@/lib/clerk/server-config";
import { synchronizeClerkIdentity } from "@/lib/dashboard/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type SignupCountry = { countryCode: string; name: string; currencyCode: string };
export type SignupPlan = {
  id: string;
  key: string;
  name: string;
  description: string;
  interval: "weekly" | "monthly";
  percentageBasisPoints: number;
  billingCurrencyCode: string | null;
  prices: Record<string, { monthlyMinor: number; annualMinor: number | null }>;
};

export async function getPublicSignupCatalog() {
  const admin = createAdminClient();
  const [{ data: countries, error: countryError }, { data: plans, error: planError }] = await Promise.all([
    admin.schema("mediasis").from("market_country_profiles")
      .select("country_code,country_name,default_currency_code").eq("active", true).order("country_name"),
    admin.schema("mediasis").from("subscription_plans")
      .select("subscription_plan_id,stable_key,display_name,description,billing_interval,default_sales_percentage_basis_points,billing_currency_code,subscription_plan_prices(currency_code,default_fixed_fee_minor,annual_fixed_fee_minor)")
      .eq("active", true).in("stable_key", ["lite", "basic"]),
  ]);
  if (countryError || planError) throw new Error(`No se pudo cargar el catálogo de planes: ${countryError?.message ?? planError?.message}`);
  const mappedCountries: SignupCountry[] = (countries ?? []).map((country) => ({
    countryCode: country.country_code, name: country.country_name, currencyCode: country.default_currency_code,
  }));
  const mappedPlans: SignupPlan[] = (plans ?? []).map((plan) => ({
    id: plan.subscription_plan_id,
    key: plan.stable_key,
    name: plan.display_name,
    description: plan.description,
    interval: plan.billing_interval as "weekly" | "monthly",
    percentageBasisPoints: plan.default_sales_percentage_basis_points,
    billingCurrencyCode: plan.billing_currency_code,
    prices: Object.fromEntries((plan.subscription_plan_prices ?? []).map((price) => [price.currency_code, {
      monthlyMinor: Number(price.default_fixed_fee_minor),
      annualMinor: price.annual_fixed_fee_minor == null ? null : Number(price.annual_fixed_fee_minor),
    }])),
  }));
  for (const country of mappedCountries) {
    for (const plan of mappedPlans) {
      const billingCurrency = plan.billingCurrencyCode ?? country.currencyCode;
      const price = plan.prices[billingCurrency];
      if (!price || !Number.isSafeInteger(price.monthlyMinor) || !Number.isSafeInteger(price.annualMinor)) {
        throw new Error(`Faltan los precios mensual y anual de ${plan.key}/${billingCurrency}.`);
      }
    }
  }
  if (mappedPlans.length !== 2) throw new Error("Faltan planes de registro activos.");
  return { countries: mappedCountries, plans: mappedPlans };
}

type SignupMetadata = { version?: unknown; countryCode?: unknown; planKey?: unknown; billingCadence?: unknown; offerId?: unknown };

export async function reconcileMerchantOnboarding() {
  if (!(await clerkAuthenticationEnabledForRequest())) return null;
  const session = await auth();
  if (!session.userId) return null;

  const admin = createAdminClient();
  const { data: priorIdentity, error: priorIdentityError } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id").eq("clerk_user_id", session.userId).maybeSingle();
  if (priorIdentityError) throw new Error(`No se pudo leer la identidad de Mediasis: ${priorIdentityError.message}`);
  if (priorIdentity) {
    const { data: existing, error: lookupError } = await admin.schema("mediasis").from("merchant_onboarding")
      .select("app_user_id,country_code,subscription_plan_id,status,current_step,billing_cadence,provisioning_idempotency_key,business_id")
      .eq("app_user_id", priorIdentity.app_user_id).maybeSingle();
    if (lookupError) throw new Error(`No se pudo leer el registro: ${lookupError.message}`);
    if (existing) return existing;
  }

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(session.userId);
  const verifiedEmail = user.emailAddresses.find((email) =>
    email.id === user.primaryEmailAddressId && email.verification?.status === "verified",
  )?.emailAddress?.toLowerCase();
  if (!verifiedEmail) return null;
  const selection = (user.unsafeMetadata as { mediasisMerchantSignup?: SignupMetadata })?.mediasisMerchantSignup;
  if (!selection || selection.version !== 1) return null;
  const billingCadence = selection.billingCadence ?? "monthly";
  if (
    typeof selection.countryCode !== "string" ||
    typeof selection.planKey !== "string" ||
    (billingCadence !== "monthly" && billingCadence !== "annual")
  ) {
    throw new Error("La selección del registro está incompleta. Contactá a Mediasis para recuperarla.");
  }
  const catalog = await getPublicSignupCatalog();
  const country = catalog.countries.find((item) => item.countryCode === selection.countryCode);
  const plan = catalog.plans.find((item) => item.key === selection.planKey);
  const price = plan && country ? plan.prices[plan.billingCurrencyCode ?? country.currencyCode] : null;
  let selectedPlanId = plan?.id ?? null;
  let selectedPrice = price?.monthlyMinor ?? null;
  let selectedCurrency = plan?.billingCurrencyCode ?? country?.currencyCode ?? null;
  // Earlier public signup briefly offered Start. A pending Clerk verification
  // still needs to resolve to that same weekly plan after its key is renamed.
  if (selection.planKey === "start" && country) {
    const { data: previousStart, error: previousStartError } = await admin.schema("mediasis")
      .from("subscription_plans")
      .select("subscription_plan_id,subscription_plan_prices(currency_code,default_fixed_fee_minor)")
      .eq("stable_key", "uber_porcentaje").eq("active", true).maybeSingle();
    if (previousStartError) throw new Error(`No se pudo recuperar el plan anterior: ${previousStartError.message}`);
    const startPrice = previousStart?.subscription_plan_prices?.find((item) => item.currency_code === country.currencyCode);
    if (startPrice && previousStart) {
      selectedPlanId = previousStart.subscription_plan_id;
      selectedPrice = Number(startPrice.default_fixed_fee_minor);
      selectedCurrency = country.currencyCode;
    }
  }
  if (!country || !selectedPlanId || (plan && (!price || (billingCadence === "annual" && price.annualMinor == null)))) {
    throw new Error("El país o plan seleccionado ya no está disponible. Contactá a Mediasis.");
  }
  let offerPriceSource: "signup" | "catalog_backfill" = "catalog_backfill";
  if (typeof selection.offerId === "string") {
    const { data: offer, error: offerError } = await admin.schema("mediasis")
      .from("merchant_signup_price_offers")
      .select("email,country_code,subscription_plan_id,billing_cadence,currency_code,fixed_fee_minor")
      .eq("offer_id", selection.offerId).single();
    if (offerError || !offer || offer.email !== verifiedEmail || offer.country_code !== country.countryCode
      || offer.subscription_plan_id !== selectedPlanId || offer.billing_cadence !== billingCadence) {
      throw new Error("No se pudo recuperar el precio de tu registro. Contactá a Mediasis.");
    }
    selectedCurrency = offer.currency_code;
    selectedPrice = Number(offer.fixed_fee_minor);
    offerPriceSource = "signup";
  }
  await synchronizeClerkIdentity(session.userId);
  const { data: identity, error: identityError } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id").eq("clerk_user_id", session.userId).single();
  if (identityError || !identity) throw new Error(`No se pudo recuperar la cuenta de Mediasis: ${identityError?.message ?? "sin identidad"}`);
  const { error: insertError } = await admin.schema("mediasis").from("merchant_onboarding").insert({
    app_user_id: identity.app_user_id, country_code: country.countryCode,
    subscription_plan_id: selectedPlanId, billing_cadence: billingCadence,
    offered_currency_code: selectedCurrency,
    offered_fixed_fee_minor: offerPriceSource === "signup" ? selectedPrice
      : plan && billingCadence === "annual" ? price?.annualMinor : selectedPrice,
    offer_price_source: selectedPrice == null ? null : offerPriceSource,
  });
  if (insertError && insertError.code !== "23505") throw new Error(`No se pudo guardar el registro: ${insertError.message}`);
  const { data: saved, error: savedError } = await admin.schema("mediasis").from("merchant_onboarding")
    .select("app_user_id,country_code,subscription_plan_id,status,current_step,billing_cadence,provisioning_idempotency_key,business_id")
    .eq("app_user_id", identity.app_user_id).single();
  if (savedError || !saved) throw new Error(`No se pudo recuperar el registro: ${savedError?.message ?? "sin datos"}`);
  return saved;
}
