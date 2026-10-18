"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptStaffPlanOffer } from "./actions";

export type StaffPlanOffer = {
  id: string;
  status: string;
  targetPlan: string;
  cadence: string;
  amountMinor: number;
  currency: string;
  effectiveAt: string;
  expiresAt: string | null;
  uberSalesPercentageBasisPoints: number | null;
};

export function StaffPlanOfferCard({ offer, isOwner, hasCard, fromUber }: { offer: StaffPlanOffer; isOwner: boolean; hasCard: boolean; fromUber: boolean }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const targetIsUber = offer.targetPlan.startsWith("uber_");
  const price = new Intl.NumberFormat("es-CR", { style: "currency", currency: offer.currency }).format(offer.amountMinor / 100);
  const frequency = offer.cadence === "annual" ? "año" : offer.cadence === "weekly" ? "semana" : "mes";
  const effective = new Date(offer.effectiveAt).toLocaleString("es-CR", { dateStyle: "long", timeStyle: "short" });

  async function confirm() {
    setSaving(true);
    try {
      const result = await acceptStaffPlanOffer(offer.id, accepted);
      if (!result.success) throw new Error(result.message);
      toast.success(result.message);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo aceptar el cambio."); }
    finally { setSaving(false); }
  }

  return <Card><CardHeader><CardTitle>Cambio de plan propuesto</CardTitle>
    <CardDescription>Revisá el precio y la fecha antes de aceptar.</CardDescription></CardHeader>
    <CardContent className="grid gap-4 text-sm">
      <div className="rounded-lg border p-4">
        <p className="font-medium">{offer.targetPlan === "basic" ? "mediasis Basic" : offer.targetPlan === "lite" ? "mediasis Lite" : offer.targetPlan}</p>
        <p>{price} por {frequency}</p>
        {targetIsUber && offer.uberSalesPercentageBasisPoints ? <p>{offer.uberSalesPercentageBasisPoints / 100}% de ventas</p> : null}
        <p>Inicio: {fromUber && !targetIsUber ? "al confirmarse el primer pago" : effective}</p>
        {offer.expiresAt ? <p>Podés aceptar hasta el {new Date(offer.expiresAt).toLocaleString("es-CR", { dateStyle: "long", timeStyle: "short" })}.</p> : null}
      </div>
      {offer.status === "processing" ? <p>Estamos verificando el pago. Tu plan actual continúa activo hasta confirmarlo.</p>
        : offer.status === "accepted" || targetIsUber ? <p>Este cambio fue programado por Mediasis. El plan actual continúa hasta la fecha indicada.</p>
        : isOwner ? <>
          {!hasCard ? <p>Guardá una tarjeta en “Método de pago” para aceptar este cambio.</p> : null}
          <label className="flex items-start gap-2"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            <span>Acepto que Mediasis cobre {price} por {frequency} {fromUber ? "ahora y en cada renovación" : "desde la fecha indicada y en cada renovación"}, hasta que cancele el plan. Si estoy en prueba, el primer cobro será al terminar los siete días originales.</span></label>
          <Button type="button" className="justify-self-start" disabled={!accepted || !hasCard || saving} onClick={() => void confirm()}>
            {saving ? "Confirmando…" : "Aceptar nuevo precio"}
          </Button>
        </> : <p>Solo el propietario activo de la cuenta del negocio puede aceptar esta propuesta.</p>}
    </CardContent>
  </Card>;
}
