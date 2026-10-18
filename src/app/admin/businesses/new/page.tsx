import { notFound, redirect } from "next/navigation";

import { AdditionalBusinessPlanSelection } from "@/components/businesses/AdditionalBusinessPlanSelection";
import { CreateBusinessForm } from "@/components/businesses/CreateBusinessForm";
import { StaffUberPlanSelection } from "@/components/businesses/StaffUberPlanSelection";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { getPublicSignupCatalog } from "@/lib/dashboard/merchant-onboarding";

export default async function CreateBusinessPage({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  const context = await getDashboardAuthorizationContext();
  if (!context || context.mode === "legacy" || !context.appUserId) notFound();
  const admin = createAdminClient();
  const { data, error } = await admin.schema("mediasis").from("market_country_profiles")
    .select("country_code,country_name,default_timezone,default_currency_code,currency_minor_unit_digits,default_locale,phone_country_code,map_center_lat,map_center_lng,map_default_zoom")
    .eq("active", true).order("country_name");
  if (error) throw new Error(`No se pudo cargar el catálogo de países: ${error.message}`);
  const countryProfiles = (data ?? []).map((profile) => ({
    countryCode: profile.country_code,
    countryName: profile.country_name,
    timezone: profile.default_timezone,
    currencyCode: profile.default_currency_code,
    locale: profile.default_locale,
    phoneCountryCode: profile.phone_country_code,
    mapCenterLat: Number(profile.map_center_lat ?? 0),
    mapCenterLng: Number(profile.map_center_lng ?? 0),
    mapDefaultZoom: Number(profile.map_default_zoom ?? 9),
  }));
  if (countryProfiles.length === 0) throw new Error("No hay países activos configurados para crear negocios.");
  const { intent } = await searchParams;
  if (!intent) {
    if (context.mode === "staff") {
      const { data: uberPlans, error: uberError } = await admin.schema("mediasis").from("subscription_plans")
        .select("stable_key,display_name,default_sales_percentage_basis_points,subscription_plan_prices(currency_code,default_fixed_fee_minor)")
        .in("stable_key", ["uber_fijo", "uber_porcentaje"]).eq("active", true);
      if (uberError || !uberPlans) throw new Error("No se pudo cargar los planes Uber.");
      const digitsByCurrency = new Map((data ?? []).map((profile) => [profile.default_currency_code,
        Number(profile.currency_minor_unit_digits)]));
      return <div className="p-4 md:p-8"><StaffUberPlanSelection markets={countryProfiles.map((profile) => ({
        countryCode: profile.countryCode, name: profile.countryName, currencyCode: profile.currencyCode,
      }))} plans={uberPlans.map((plan) => ({
        key: plan.stable_key as "uber_fijo" | "uber_porcentaje", name: plan.display_name,
        defaultPercentage: Number(plan.default_sales_percentage_basis_points) / 100,
        prices: Object.fromEntries((plan.subscription_plan_prices ?? []).map((price) =>
          [price.currency_code, Number(price.default_fixed_fee_minor) / (10 ** (digitsByCurrency.get(price.currency_code) ?? 2))])),
      }))} /></div>;
    }
    const catalog = await getPublicSignupCatalog();
    return <div className="p-4 md:p-8"><AdditionalBusinessPlanSelection catalog={catalog} /></div>;
  }
  const { data: selection, error: selectionError } = await admin.schema("mediasis").from("additional_business_onboarding")
    .select("country_code,provisioning_idempotency_key,status,business_id,subscription_plans!inner(stable_key)")
    .eq("additional_business_onboarding_id", intent).eq("owner_app_user_id", context.appUserId).maybeSingle();
  if (selectionError) throw new Error(`No se pudo recuperar el plan seleccionado: ${selectionError.message}`);
  if (!selection || !["selected", "provisioning", "payment_method"].includes(selection.status)) notFound();
  if (selection.business_id && selection.status === "payment_method") {
    const { data: guided } = await admin.schema("mediasis").from("guided_storefront_onboarding")
      .select("business_id").eq("business_id", selection.business_id).maybeSingle();
    if (guided) redirect(`/clerk-auth/onboarding/setup?business=${encodeURIComponent(selection.business_id)}`);
  }
  const plan = Array.isArray(selection.subscription_plans) ? selection.subscription_plans[0] : selection.subscription_plans;
  const isUber = plan?.stable_key === "uber_fijo" || plan?.stable_key === "uber_porcentaje";
  if (isUber !== (context.mode === "staff")) notFound();
  if (!isUber) redirect(`/clerk-auth/onboarding/new?intent=${encodeURIComponent(intent)}`);
  return <div className="p-4 md:p-8"><CreateBusinessForm countryProfiles={countryProfiles} lockCountry guided={!isUber} initialValues={{
    countryCode: selection.country_code,
    idempotencyKey: selection.provisioning_idempotency_key,
  }} /></div>;
}
