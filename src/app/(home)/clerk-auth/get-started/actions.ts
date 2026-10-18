"use server";

import { createAdminClient } from "@/lib/supabase/admin";

type OfferRequest = {
  email: string;
  countryCode: string;
  planKey: string;
  billingCadence: "monthly" | "annual";
  displayedFixedFeeMinor: number;
};

export async function saveMerchantSignupOffer(request: OfferRequest) {
  const email = request.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320
    || !Number.isSafeInteger(request.displayedFixedFeeMinor) || request.displayedFixedFeeMinor < 0
    || !["monthly", "annual"].includes(request.billingCadence)
    || !["lite", "basic"].includes(request.planKey)) {
    throw new Error("Revisá tu correo y el plan seleccionado.");
  }
  const admin = createAdminClient();
  const [{ data: country, error: countryError }, { data: plan, error: planError }] = await Promise.all([
    admin.schema("mediasis").from("market_country_profiles")
      .select("country_code,default_currency_code").eq("country_code", request.countryCode).eq("active", true).single(),
    admin.schema("mediasis").from("subscription_plans")
      .select("subscription_plan_id,billing_currency_code,billing_interval,subscription_plan_prices(currency_code,default_fixed_fee_minor,annual_fixed_fee_minor)")
      .eq("stable_key", request.planKey).eq("active", true).single(),
  ]);
  if (countryError || planError || !country || !plan || plan.billing_interval !== "monthly") {
    throw new Error("El país o plan seleccionado ya no está disponible.");
  }
  const currencyCode = plan.billing_currency_code ?? country.default_currency_code;
  const catalogPrice = plan.subscription_plan_prices?.find((price) => price.currency_code === currencyCode);
  const fixedFeeMinor = Number(request.billingCadence === "annual"
    ? catalogPrice?.annual_fixed_fee_minor : catalogPrice?.default_fixed_fee_minor);
  if (!Number.isSafeInteger(fixedFeeMinor) || fixedFeeMinor !== request.displayedFixedFeeMinor) {
    throw new Error("El precio del plan cambió. Actualizá la página para ver el nuevo precio.");
  }
  const { data: offer, error } = await admin.schema("mediasis").from("merchant_signup_price_offers")
    .insert({
      email, country_code: country.country_code, subscription_plan_id: plan.subscription_plan_id,
      billing_cadence: request.billingCadence, currency_code: currencyCode, fixed_fee_minor: fixedFeeMinor,
    }).select("offer_id").single();
  if (error || !offer) throw new Error(`No se pudo guardar el precio seleccionado: ${error?.message ?? "sin oferta"}`);
  return offer.offer_id as string;
}
