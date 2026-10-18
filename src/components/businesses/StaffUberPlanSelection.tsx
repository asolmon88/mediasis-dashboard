"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { selectStaffUberPlan } from "@/app/admin/businesses/new/actions";

type Market = { countryCode: string; name: string; currencyCode: string };
type UberPlan = { key: "uber_fijo" | "uber_porcentaje"; name: string; defaultPercentage: number; prices: Record<string, number> };

export function StaffUberPlanSelection({ markets, plans }: { markets: Market[]; plans: UberPlan[] }) {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState(markets[0]?.countryCode ?? "CR");
  const [planKey, setPlanKey] = useState<"uber_fijo" | "uber_porcentaje">("uber_fijo");
  const selectedMarket = markets.find((market) => market.countryCode === countryCode);
  const selectedPlan = plans.find((plan) => plan.key === planKey);
  const [weeklyFee, setWeeklyFee] = useState<string | null>(null);
  const [salesPercentage, setSalesPercentage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultFee = selectedPlan?.prices[selectedMarket?.currencyCode ?? ""] ?? 0;

  return <main className="mx-auto max-w-2xl space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
    <div><h1 className="text-2xl font-semibold">Nuevo negocio Uber</h1>
      <p className="text-sm text-muted-foreground">Definí el plan y sus términos antes de crear el negocio. Se activará al completar el aprovisionamiento.</p></div>
    <label className="block space-y-2 text-sm font-medium">País
      <select className="w-full rounded-lg border bg-background p-3" value={countryCode} onChange={(event) => { setCountryCode(event.target.value); setWeeklyFee(null); }}>
        {markets.map((market) => <option key={market.countryCode} value={market.countryCode}>{market.name}</option>)}
      </select></label>
    <label className="block space-y-2 text-sm font-medium">Plan
      <select className="w-full rounded-lg border bg-background p-3" value={planKey} onChange={(event) => { setPlanKey(event.target.value as "uber_fijo" | "uber_porcentaje"); setWeeklyFee(null); setSalesPercentage(null); }}>
        {plans.map((plan) => <option key={plan.key} value={plan.key}>{plan.name}</option>)}
      </select></label>
    <label className="block space-y-2 text-sm font-medium">Tarifa fija semanal ({selectedMarket?.currencyCode})
      <input className="w-full rounded-lg border bg-background p-3" type="number" min="0" step="0.01"
        value={weeklyFee ?? String(defaultFee)} onChange={(event) => setWeeklyFee(event.target.value)} /></label>
    <label className="block space-y-2 text-sm font-medium">Porcentaje de ventas (%)
      <input className="w-full rounded-lg border bg-background p-3" type="number" min="0" max="100" step="0.01"
        value={salesPercentage ?? String(selectedPlan?.defaultPercentage ?? 0)} onChange={(event) => setSalesPercentage(event.target.value)} /></label>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button className="rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={busy || !selectedMarket || !selectedPlan}
      onClick={async () => {
        setBusy(true); setError(null);
        try {
          const result = await selectStaffUberPlan({ planKey, countryCode,
            weeklyFee: Number(weeklyFee ?? defaultFee), salesPercentage: Number(salesPercentage ?? selectedPlan?.defaultPercentage) });
          router.push(`/admin/businesses/new?intent=${result.intentId}`);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el plan."); }
        finally { setBusy(false); }
      }}>Continuar</button>
  </main>;
}
