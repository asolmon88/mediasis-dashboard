"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelScheduledPlanChange, confirmPlanChange, getPlanChangeQuote,
  type PlanChangeQuote, type SubscriptionBillingData } from "./actions";

type ChangeType = "plan" | "cadence";
type Pending = { changeType: ChangeType; effectiveAt: string; renewalAmountMinor: number; currencyCode: string };

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("es-CR", { style: "currency", currency }).format(minor / 100);
}
function date(value: string) {
  return new Intl.DateTimeFormat("es-CR", { dateStyle: "long", timeStyle: "short", timeZone: "America/Costa_Rica" }).format(new Date(value));
}

export function PlanChangeCard({ currentPlan, subscription, isOwner, pending }: {
  currentPlan: "lite" | "basic"; subscription: SubscriptionBillingData;
  isOwner: boolean; pending: Pending[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [selection, setSelection] = useState<{ type: ChangeType; target: string } | null>(null);
  const [quote, setQuote] = useState<PlanChangeQuote | null>(null);
  const [accepted, setAccepted] = useState(false);
  const targetPlan = currentPlan === "lite" ? "basic" : "lite";
  const targetCadence = subscription.billingCadence === "monthly" ? "annual" : "monthly";
  const eligible = isOwner && ["trialing", "active"].includes(subscription.status);

  const preview = (type: ChangeType, target: string) => {
    setSelection({ type, target }); setQuote(null); setAccepted(false);
    startTransition(async () => setQuote(await getPlanChangeQuote(type, target)));
  };
  const confirm = () => {
    if (!selection || !quote?.success || !quote.subscription_updated_at || quote.charge_minor == null
      || quote.renewal_amount_minor == null) return;
    startTransition(async () => {
      const result = await confirmPlanChange({ changeType: selection.type, target: selection.target,
        expectedChargeMinor: quote.charge_minor!, expectedRenewalMinor: quote.renewal_amount_minor!,
        expectedUpdatedAt: quote.subscription_updated_at!, acceptedTerms: accepted });
      result.success ? toast.success(result.message) : toast.error(result.message);
      if (result.success) { setQuote(null); setSelection(null); setAccepted(false); router.refresh(); }
    });
  };
  const cancel = (type: ChangeType) => startTransition(async () => {
    const result = await cancelScheduledPlanChange(type);
    result.success ? toast.success(result.message) : toast.error(result.message);
    if (result.success) router.refresh();
  });

  return <Card>
    <CardHeader><CardTitle>Cambiar plan</CardTitle><CardDescription>
      Revisá el importe y la fecha antes de aceptar un nuevo cobro recurrente.
    </CardDescription></CardHeader>
    <CardContent className="grid gap-5">
      <p className="text-sm">Plan actual: <strong>mediasis {currentPlan === "lite" ? "Lite" : "Basic"}</strong> · {subscription.billingCadence === "annual" ? "Anual" : "Mensual"}</p>
      {!isOwner ? <p className="text-sm text-muted-foreground">Solo el propietario activo de la cuenta del negocio puede confirmar cambios.</p> : null}
      {isOwner && !eligible ? <p className="text-sm text-muted-foreground">Resolvé primero el estado de tu suscripción para cambiar el plan.</p> : null}
      {eligible ? <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => preview("plan", targetPlan)}>
          {currentPlan === "lite" ? "Pasar a Basic" : "Pasar a Lite"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => preview("cadence", targetCadence)}>
          Cambiar a {targetCadence === "annual" ? "anual" : "mensual"}
        </Button>
      </div> : null}
      {selection && quote && !quote.success ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {quote.message ?? "Este cambio requiere ayuda del equipo de Mediasis."}
      </p> : null}
      {selection && quote?.success ? <div className="grid gap-3 rounded-xl border p-4 text-sm">
        <p><strong>{quote.mode === "upgrade" ? "Cambio inmediato tras confirmar el pago" : quote.mode === "trial" ? "Cambio durante la prueba" : "Cambio en la próxima renovación"}</strong></p>
        <p>Nuevo plan: mediasis {quote.target_plan === "basic" ? "Basic" : "Lite"} · {quote.target_cadence === "annual" ? "Anual" : "Mensual"}</p>
        <p>Fecha efectiva: {quote.effective_at ? date(quote.effective_at) : "—"}</p>
        <p>Cobro ahora: <strong>{money(quote.charge_minor ?? 0, quote.currency_code ?? "USD")}</strong></p>
        <p>Próxima renovación: <strong>{money(quote.renewal_amount_minor ?? 0, quote.currency_code ?? "USD")}</strong> por {quote.target_cadence === "annual" ? "año" : "mes"}.</p>
        {quote.mode === "upgrade" && quote.period_ends_at ? <p>El periodo y la fecha de renovación originales se mantienen hasta el {date(quote.period_ends_at)}.</p> : null}
        <label className="flex items-start gap-2"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1" />
          <span>Acepto el cobro indicado y los cargos recurrentes del nuevo plan desde la fecha señalada.</span>
        </label>
        <Button className="w-fit" disabled={busy || !accepted} onClick={confirm}>Confirmar cambio</Button>
      </div> : null}
      {pending.map((item) => <div key={item.changeType} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <span>Cambio de {item.changeType === "plan" ? "plan" : "frecuencia"} programado para el {date(item.effectiveAt)} · {money(item.renewalAmountMinor, item.currencyCode)}</span>
        {isOwner ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => cancel(item.changeType)}>Cancelar cambio</Button> : null}
      </div>)}
    </CardContent>
  </Card>;
}
