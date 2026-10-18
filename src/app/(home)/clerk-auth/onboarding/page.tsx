import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { CreateBusinessForm, type MarketCountryProfile } from "@/components/businesses/CreateBusinessForm";
import { reconcileMerchantOnboarding } from "@/lib/dashboard/merchant-onboarding";
import { createAdminClient } from "@/lib/supabase/admin";
import { LocationStoreProvider } from "@/stores/location-store";

export default async function MerchantOnboardingPage() {
  const session = await auth();
  if (!session.userId) redirect("/clerk-auth/sign-in");
  const record = await reconcileMerchantOnboarding();
  if (!record || record.status === "completed") redirect("/admin");
  const admin = createAdminClient();
  if (record.business_id) {
    const { data: guided } = await admin.schema("mediasis").from("guided_storefront_onboarding")
      .select("business_id").eq("business_id", record.business_id).maybeSingle();
    if (guided) redirect(`/clerk-auth/onboarding/setup?business=${encodeURIComponent(record.business_id)}`);
  }
  const [{ data: profile, error: profileError }, { data: request, error: requestError }, { data: plan, error: planError }] = await Promise.all([
    admin.schema("mediasis").from("market_country_profiles")
      .select("country_code,country_name,default_timezone,default_currency_code,default_locale,phone_country_code,map_center_lat,map_center_lng,map_default_zoom")
      .eq("country_code", record.country_code).eq("active", true).single(),
    admin.schema("mediasis").from("business_provisioning_requests")
      .select("requested_business_name,requested_location_name,requested_phone,requested_lat,requested_lng")
      .eq("creator_app_user_id", record.app_user_id)
      .eq("idempotency_key", record.provisioning_idempotency_key).maybeSingle(),
    admin.schema("mediasis").from("subscription_plans")
      .select("trial_duration_days").eq("subscription_plan_id", record.subscription_plan_id).single(),
  ]);
  if (profileError || !profile || requestError || planError || !plan) throw new Error("No se pudo recuperar el negocio en creación.");
  const countryProfiles: MarketCountryProfile[] = [{
    countryCode: profile.country_code, countryName: profile.country_name,
    timezone: profile.default_timezone, currencyCode: profile.default_currency_code,
    locale: profile.default_locale, phoneCountryCode: profile.phone_country_code,
    mapCenterLat: Number(profile.map_center_lat ?? 0), mapCenterLng: Number(profile.map_center_lng ?? 0),
    mapDefaultZoom: Number(profile.map_default_zoom ?? 9),
  }];
  return <main className="min-h-svh bg-[#f6f8fc] px-4 py-6 sm:px-6 lg:px-10">
    <div className="mx-auto mb-6 max-w-7xl">
      <img src="/mediasis-logo.png" alt="Mediasis" className="mb-5 h-9 w-auto" />
      <p className="text-sm font-semibold text-[#0067ff]">Paso 1 de 6</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-950">Configurá tu negocio</h1>
      <p className="mt-2 text-sm text-slate-600">{plan.trial_duration_days === 7
        ? "Tu prueba gratis comienza cuando se complete la creación del negocio."
        : "Terminá la configuración para acceder al panel de tu negocio."}</p>
    </div>
    <LocationStoreProvider initialLocations={[]}>
      <CreateBusinessForm countryProfiles={countryProfiles} onboarding trialEligible={plan.trial_duration_days === 7} initialValues={{
        idempotencyKey: record.provisioning_idempotency_key,
        full_name: request?.requested_business_name ?? "",
        short_name: request?.requested_location_name ?? "",
        phone: request?.requested_phone ?? "",
        location: request ? { lat: Number(request.requested_lat), lng: Number(request.requested_lng) } : undefined,
      }} />
    </LocationStoreProvider>
  </main>;
}
