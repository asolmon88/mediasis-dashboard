"use client";

import { useRouter } from "next/navigation";

import { OnvoCardManager } from "@/app/admin/settings/billing/onvo-card-manager";

export function OnboardingPaymentCard({ businessId, billingEmail, priceLabel, firstChargeLabel, recovery, storedCard, cancellationFeeTerms, guided = false }: {
  businessId: string;
  billingEmail: string;
  priceLabel: string;
  firstChargeLabel: string;
  recovery: boolean;
  cancellationFeeTerms: { termsVersion: string; amountMinor: number; currencyCode: string } | null;
  storedCard: { brand: string | null; label: string | null; last4: string | null } | null;
  guided?: boolean;
}) {
  const router = useRouter();
  return <div className="mx-auto w-full max-w-2xl space-y-6">
    <div className="text-center"><p className="text-sm font-semibold text-[#0067ff]">{recovery ? "Recuperar acceso" : guided ? "Paso 6 de 6" : "Último paso"}</p><h1 className="mt-2 text-3xl font-bold text-slate-950">{recovery ? "Elegí o agregá una tarjeta" : "Agregá tu tarjeta"}</h1><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">{recovery ? <>Tu plan es <strong>{priceLabel}</strong>. Guardar una tarjeta no reactiva el negocio: volvé al panel y completá el pago pendiente. Las fechas originales de tu prueba y renovación no cambian.</> : <>Tu plan es <strong>{priceLabel}</strong>. No se cobrará hasta que termine tu prueba gratis de 7 días, el {firstChargeLabel}.</>}</p></div>
    {guided && !recovery ? <button className="text-sm text-blue-600 underline" onClick={() => router.push(`/clerk-auth/onboarding/setup?business=${encodeURIComponent(businessId)}&edit=review`)}>← Volver a revisar mi app</button> : null}
    <OnvoCardManager canManage billingEmail={billingEmail} storedCard={storedCard} onboardingBusinessId={businessId} recovery={recovery} cancellationFeeTerms={cancellationFeeTerms} onSaved={() => window.setTimeout(() => router.replace("/admin"), 300)} />
  </div>;
}
