"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { selectAdditionalBusinessPlan } from "@/app/admin/businesses/new/actions";
import { MediasisPlanCatalog } from "@/components/auth/MediasisPlanCatalog";
import type { SignupCountry, SignupPlan } from "@/lib/dashboard/merchant-onboarding";

export function AdditionalBusinessPlanSelection({ catalog }: { catalog: { countries: SignupCountry[]; plans: SignupPlan[] } }) {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState(catalog.countries[0]?.countryCode ?? "");
  const [billingCadence, setBillingCadence] = useState<"monthly" | "annual">("monthly");
  const [busyPlan, setBusyPlan] = useState<"lite" | "basic" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectPlan = async (planKey: "lite" | "basic") => {
    setBusyPlan(planKey); setError(null);
    try {
      const selection = await selectAdditionalBusinessPlan({ planKey, countryCode, billingCadence });
      router.push(`/clerk-auth/onboarding/new?intent=${selection.intentId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el plan.");
    } finally { setBusyPlan(null); }
  };

  return <main className="mx-auto max-w-6xl py-4 text-slate-950"><MediasisPlanCatalog
    catalog={catalog} countryCode={countryCode} billingCadence={billingCadence}
    onCountryChange={setCountryCode} onCadenceChange={setBillingCadence} onSelectPlan={selectPlan}
    busyPlan={busyPlan} error={error} eyebrow="Nuevo negocio"
    description="Cada negocio tiene su propia prueba gratis de 7 días."
  /></main>;
}
