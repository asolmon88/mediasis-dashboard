"use client";

import { useState } from "react";

import { MediasisPlanCatalog } from "@/components/auth/MediasisPlanCatalog";
import type { SignupCountry, SignupPlan } from "@/lib/dashboard/merchant-onboarding";
import { beginBusinessOnboardingFromPlans } from "./actions";

export function DashboardPlansCatalog({ catalog }: { catalog: { countries: SignupCountry[]; plans: SignupPlan[] } }) {
  const [countryCode, setCountryCode] = useState(catalog.countries[0]?.countryCode ?? "");
  const [billingCadence, setBillingCadence] = useState<"monthly" | "annual">("monthly");
  const [busyPlan, setBusyPlan] = useState<"lite" | "basic" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function selectPlan(planKey: "lite" | "basic") {
    setBusyPlan(planKey); setError(null);
    try {
      await beginBusinessOnboardingFromPlans({ planKey, countryCode, billingCadence });
      // The onboarding page reads both the Clerk session and the newly written
      // onboarding row. A document navigation avoids a stale App Router tree
      // (especially after Fast Refresh) sending the user back to /admin.
      window.location.assign("/clerk-auth/onboarding");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el plan.");
    } finally { setBusyPlan(null); }
  }
  return <MediasisPlanCatalog catalog={catalog} countryCode={countryCode} billingCadence={billingCadence}
    onCountryChange={setCountryCode} onCadenceChange={setBillingCadence} onSelectPlan={selectPlan}
    busyPlan={busyPlan} error={error} eyebrow="Empezá con Mediasis"
    description="Elegí tu plan, creá tu negocio y comenzá con 7 días gratis." surface="standalone" />;
}
