"use client";

import { useState, useTransition } from "react";
import { CalendarClock, CreditCard, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setSubscriptionCancellation, type SubscriptionBillingData } from "./actions";

function money(value: number, currency: string) { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 100); }
function date(value: string | null) { return value ? new Intl.DateTimeFormat("es-CR", { dateStyle: "long", timeStyle: "short" }).format(new Date(value)) : null; }

export function SubscriptionBillingCard({ subscription, canManage }: { subscription: SubscriptionBillingData | null; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [acceptedFinalFee, setAcceptedFinalFee] = useState(false);
  if (!subscription) return null;
  const cancelled = subscription.status === "cancelled";
  const status = ({ trialing: "Prueba gratis", active: "Activa", past_due: "Pago pendiente", cancelled: "Cancelación programada", suspended: "Pausada", awaiting_card: "Falta tarjeta" } as Record<string, string>)[subscription.status] ?? subscription.status;
  const changeCancellation = (next: boolean) => startTransition(async () => {
    const result = await setSubscriptionCancellation(next, next && acceptedFinalFee);
    result.success ? toast.success(result.message) : toast.error(result.message);
  });
  return <>
    <Card><CardHeader><CardTitle>Suscripción</CardTitle><CardDescription>El precio acordado para este negocio y el estado de su renovación.</CardDescription></CardHeader><CardContent className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4"><div><p className="text-sm text-muted-foreground">{status}</p><p className="text-xl font-semibold">{money(subscription.amountMinor, subscription.currencyCode)} {subscription.billingCadence === "annual" ? "por año" : "por mes"}</p></div><CalendarClock className="size-6 text-[#0067ff]" /></div>
      {subscription.card ? <p className="flex items-center gap-2 text-sm"><CreditCard className="size-4" /> {subscription.card.brand ?? "Tarjeta"} {subscription.card.label ?? "guardada"}</p> : null}
      {subscription.graceEndsAt ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Tu pago está pendiente. Conservás acceso hasta el {date(subscription.graceEndsAt)}.</p> : null}
      {subscription.cancelAt ? <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Tu acceso continuará hasta el {date(subscription.cancelAt)}. {subscription.cancellationFeeApplies ? `En esa fecha se cobrará una única cuota final de ${money(subscription.amountMinor, subscription.currencyCode)}. Este pago no extenderá el acceso.` : "No habrá otro cobro automático."}</p> : subscription.nextChargeAt ? <p className="text-sm text-muted-foreground">Próximo cobro: {date(subscription.nextChargeAt)}.</p> : null}
      {canManage && !cancelled && subscription.cancellationFeeApplies && subscription.status === "active" ? <label className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><input type="checkbox" checked={acceptedFinalFee} onChange={(event) => setAcceptedFinalFee(event.target.checked)} className="mt-1" /><span>Entiendo que, si cancelo, conservaré acceso hasta el {date(subscription.currentPeriodEndsAt)} y autorizo un único cargo final de {money(subscription.amountMinor, subscription.currencyCode)} en esa fecha. Ese cargo no extenderá mi acceso.</span></label> : null}
      {canManage ? <Button variant={cancelled ? "default" : "outline"} onClick={() => changeCancellation(!cancelled)} disabled={pending || (!cancelled && subscription.cancellationFeeApplies && subscription.status === "active" && !acceptedFinalFee)}>{cancelled ? "Reactivar renovación" : "Cancelar suscripción"}</Button> : null}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Comprobantes de suscripción</CardTitle><CardDescription>Recibos de pagos confirmados de Mediasis.</CardDescription></CardHeader><CardContent>{subscription.receipts.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"><ReceiptText className="mx-auto mb-2 size-5" />Todavía no hay comprobantes de suscripción.</div> : <div className="grid gap-2">{subscription.receipts.map((receipt) => <div key={receipt.receipt_number} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span><strong>{receipt.receipt_number}</strong><br /><span className="text-muted-foreground">{date(receipt.paid_at)}</span></span><strong>{money(receipt.amount_minor, receipt.currency_code)}</strong></div>)}</div>}</CardContent></Card>
  </>;
}
