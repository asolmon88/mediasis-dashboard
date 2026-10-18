import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { loadGuidedOnboarding } from "@/lib/dashboard/guided-onboarding";
import { createAdminClient } from "@/lib/supabase/admin";
import { LocationStoreProvider } from "@/stores/location-store";
import { GuidedStorefrontWizard } from "./GuidedStorefrontWizard";

export default async function GuidedSetupPage({ searchParams }: {
  searchParams: Promise<{ business?: string; edit?: string }>;
}) {
  const session = await auth();
  if (!session.userId) redirect("/clerk-auth/sign-in");
  const { business, edit } = await searchParams;
  if (!business) redirect("/clerk-auth/onboarding");
  const state = await loadGuidedOnboarding(business);
  if (state.step === "completed") redirect("/admin");
  if (state.step === "payment_method" && edit !== "review")
    redirect(`/clerk-auth/onboarding/payment?business=${encodeURIComponent(business)}`);
  const storefrontBaseUrl = process.env.NODE_ENV === "development" ? "http://localhost:3001" : "https://www.mediasis.cr";
  const admin = createAdminClient();
  const { data: user } = await admin.schema("mediasis").from("app_users").select("app_user_id")
    .eq("clerk_user_id", session.userId).maybeSingle();
  const { data: otherBusiness } = user ? await admin.schema("mediasis").from("business_memberships")
    .select("business_id").eq("app_user_id", user.app_user_id).eq("status", "active")
    .neq("business_id", business).limit(1) : { data: null };
  return <main className="min-h-svh bg-[#f6f8fc] px-4 py-8 sm:py-12">
    <div className="mx-auto mb-6 flex max-w-6xl items-center justify-between">
      <img src="/mediasis-logo.png" alt="Mediasis" className="h-9 w-auto" />
      {otherBusiness?.length ? <Link href="/admin" className="rounded-full border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Volver al dashboard</Link> : null}
    </div>
    <LocationStoreProvider initialLocations={[]}>
      <GuidedStorefrontWizard initialState={state} storefrontBaseUrl={storefrontBaseUrl} editReview={edit === "review"} />
    </LocationStoreProvider>
  </main>;
}
