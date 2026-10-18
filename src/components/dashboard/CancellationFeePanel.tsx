"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getCancellationFeeStatus, payCancellationFee, type CancellationFeeStatus } from "@/app/(home)/clerk-auth/subscription-required/cancellation-fee-actions";

declare global {
  interface Window {
    ONVO?: (publishableKey: string) => { handleNextAction: (input: { paymentIntentId: string }) => Promise<unknown> };
  }
}

export function CancellationFeePanel({ businessId, canPay, hasFee, amount, dueAt }: {
  businessId: string; canPay: boolean; hasFee: boolean; amount: string | null; dueAt: string | null;
}) {
  const [result, setResult] = useState<CancellationFeeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const submitting = useRef(false);
  useEffect(() => { if (!canPay || !hasFee) return; let active = true;
    void getCancellationFeeStatus(businessId).then((next) => { if (active) setResult(next); });
    return () => { active = false; };
  }, [businessId, canPay, hasFee]);
  const refresh = async () => { setBusy(true); try { setResult(await getCancellationFeeStatus(businessId)); } finally { setBusy(false); } };
  const pay = async () => {
    if (busy || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      let next = await payCancellationFee(businessId);
      setResult(next);
      if (next.status === "action_required" && next.paymentIntentId && next.publishableKey) {
        if (!sdkReady || !window.ONVO) {
          setResult({ status: "unknown", message: "No cargó la autenticación bancaria. Recargá la página y consultá el mismo pago." });
          return;
        }
        try { await window.ONVO(next.publishableKey).handleNextAction({ paymentIntentId: next.paymentIntentId }); }
        catch { /* Closing 3DS is not a verified decline. */ }
        next = await getCancellationFeeStatus(businessId);
        setResult(next);
      }
    } finally { submitting.current = false; setBusy(false); }
  };
  return <main className="flex min-h-[calc(100svh-4rem)] items-center justify-center bg-[#f6f8fc] p-5">
    <Script src="https://js.onvopay.com/v1/" strategy="afterInteractive" onReady={() => setSdkReady(true)} />
    <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <p className="text-sm font-bold text-[#0067ff]">mediasis</p>
      <h1 className="mt-5 text-3xl font-semibold text-slate-950">Tu suscripción terminó</h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">El acceso al negocio finalizó{dueAt ? ` el ${new Date(dueAt).toLocaleDateString("es-CR")}` : ""}. Tus datos siguen guardados.</p>
      {amount ? <p className="mt-3 text-sm text-slate-700">Cargo final acordado: <strong>{amount}</strong>. Pagarlo no reactiva la suscripción.</p> : null}
      {!hasFee ? <p className="mt-5 text-sm text-slate-600">No habrá otro cobro automático.</p> : canPay ? <div className="mt-6 space-y-3">
        <p role={result?.status === "failed" || result?.status === "unknown" ? "alert" : "status"}
          className={result?.status === "failed" || result?.status === "unknown"
            ? "rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800"
            : "text-sm text-slate-600"}>{result?.message ?? "Consultando el cargo final..."}</p>
        {result && ["failed", "action_required", "processing"].includes(result.status) ?
          <Button className="w-full" disabled={busy || result.status === "unknown"} onClick={() => void pay()}>
            {busy ? "Verificando..." : result.status === "action_required" ? "Verificar con mi banco" : result.status === "failed" ? "Pagar cargo final" : "Verificar pago"}
          </Button> : null}
        <Button className="w-full" variant="outline" disabled={busy} onClick={() => void refresh()}>Actualizar estado</Button>
      </div> : <p className="mt-5 text-sm text-slate-600">Solo el propietario puede revisar el cargo final. Podés cambiar a otro negocio desde el menú lateral.</p>}
    </section>
  </main>;
}
