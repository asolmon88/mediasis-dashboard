import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CreateBusinessForm, type MarketCountryProfile } from "@/components/businesses/CreateBusinessForm";
import { createAdminClient } from "@/lib/supabase/admin";
import { LocationStoreProvider } from "@/stores/location-store";

export default async function AdditionalBusinessOnboardingPage({ searchParams }: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/clerk-auth/sign-in");
  const { intent } = await searchParams;
  if (!intent || !/^[0-9a-f-]{36}$/i.test(intent)) notFound();
  const admin = createAdminClient();
  const { data: owner } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id").eq("clerk_user_id", userId).maybeSingle();
  if (!owner) notFound();
  const { data: selection, error } = await admin.schema("mediasis").from("additional_business_onboarding")
    .select("country_code,provisioning_idempotency_key,status,business_id,subscription_plans!inner(stable_key)")
    .eq("additional_business_onboarding_id", intent).eq("owner_app_user_id", owner.app_user_id).maybeSingle();
  if (error || !selection || !["selected", "provisioning", "payment_method"].includes(selection.status)) notFound();
  const plan = Array.isArray(selection.subscription_plans) ? selection.subscription_plans[0] : selection.subscription_plans;
  if (plan?.stable_key !== "lite" && plan?.stable_key !== "basic") notFound();
  if (selection.business_id && selection.status === "payment_method") {
    const { data: guided } = await admin.schema("mediasis").from("guided_storefront_onboarding")
      .select("business_id").eq("business_id", selection.business_id).maybeSingle();
    if (guided) redirect(`/clerk-auth/onboarding/setup?business=${encodeURIComponent(selection.business_id)}`);
  }
  const { data: profile, error: profileError } = await admin.schema("mediasis").from("market_country_profiles")
    .select("country_code,country_name,default_timezone,default_currency_code,default_locale,phone_country_code,map_center_lat,map_center_lng,map_default_zoom")
    .eq("country_code", selection.country_code).eq("active", true).maybeSingle();
  if (profileError || !profile) throw new Error("No se pudo cargar el país del negocio.");
  const countryProfiles: MarketCountryProfile[] = [{
    countryCode: profile.country_code, countryName: profile.country_name,
    timezone: profile.default_timezone, currencyCode: profile.default_currency_code,
    locale: profile.default_locale, phoneCountryCode: profile.phone_country_code,
    mapCenterLat: Number(profile.map_center_lat ?? 0), mapCenterLng: Number(profile.map_center_lng ?? 0),
    mapDefaultZoom: Number(profile.map_default_zoom ?? 9),
  }];
  return <main className="min-h-svh bg-[#f6f8fc] px-4 py-6 sm:px-6 lg:px-10">
    <div className="mx-auto mb-5 flex max-w-7xl items-center justify-between gap-4">
      <Link href="/admin" aria-label="Mediasis"><img src="/mediasis-logo.png" alt="Mediasis" className="h-9 w-auto" /></Link>
      <Link href="/admin" className="rounded-full border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Volver al dashboard</Link>
    </div>
    <div className="mx-auto mb-6 max-w-7xl"><p className="text-sm font-semibold text-blue-600">Paso 1 de 6</p>
      <h1 className="mt-1 text-3xl font-bold text-slate-950">Creá tu nueva app</h1>
      <p className="mt-1 text-sm text-slate-600">Podrás compartir el enlace de la app después de guardar el negocio. Los pedidos se habilitarán cuando activés la prueba.</p></div>
    <LocationStoreProvider initialLocations={[]}>
      <CreateBusinessForm countryProfiles={countryProfiles} lockCountry initialValues={{
        countryCode: selection.country_code,
        idempotencyKey: selection.provisioning_idempotency_key,
      }} />
    </LocationStoreProvider>
  </main>;
}
