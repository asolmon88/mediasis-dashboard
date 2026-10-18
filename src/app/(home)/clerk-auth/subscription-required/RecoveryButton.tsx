"use client";

import Script from "next/script";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { getSubscriptionRecoveryStatus, requestSubscriptionRecovery, type RecoveryStatus } from "./actions";

declare global {
  interface Window {
    ONVO?: (publishableKey: string) => {
      handleNextAction: (input: { paymentIntentId: string }) => Promise<unknown>;
    };
  }
}

export function RecoveryButton({ businessId, mode = "reactivate" }: { businessId: string; mode?: "reactivate" | "grace" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [result, setResult] = useState<RecoveryStatus | null>(null);
  const paymentSubmissionRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    void getSubscriptionRecoveryStatus(businessId).then((status) => { if (mounted) setResult(status); });
    return () => { mounted = false; };
  }, [businessId]);

  const refresh = async () => {
    setBusy(true);
    try {
      const current = await getSubscriptionRecoveryStatus(businessId);
      setResult(current);
      if (current.status === "paid") router.refresh();
    } finally { setBusy(false); }
  };

  const pay = async () => {
    if (paymentSubmissionRef.current || busy) return;
    paymentSubmissionRef.current = true;
    setBusy(true);
    try {
      let current = await requestSubscriptionRecovery(businessId);
      setResult(current);
      // The first request schedules a durable charge claim. Watch only its
      // status; never submit another confirmation while the worker creates it.
      if (current.status === "processing") {
        for (let check = 0; check < 12; check++) {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          current = await getSubscriptionRecoveryStatus(businessId);
          setResult(current);
          if (current.status !== "processing") break;
        }
      }
      if (current.status === "paid") {
        router.refresh();
      } else if (current.status === "action_required" && current.paymentIntentId && current.publishableKey) {
        if (!sdkReady || !window.ONVO) {
          setResult({ status: "unknown", message: "No cargó la autenticación bancaria. Recargá la página y consultá el estado del mismo pago." });
          return;
        }
        try {
          await window.ONVO(current.publishableKey).handleNextAction({ paymentIntentId: current.paymentIntentId });
        } catch {
          // A closed or failed 3DS window is not a confirmed decline. Ask the
          // server to read this same intent before reporting any outcome.
        }
        const verified = await getSubscriptionRecoveryStatus(businessId);
        setResult(verified);
        if (verified.status === "paid") router.refresh();
      }
    } finally { paymentSubmissionRef.current = false; setBusy(false); }
  };

  if (mode === "grace") return <div className="flex w-full flex-col items-center justify-center gap-3 text-center lg:flex-row lg:text-left">
    <Script src="https://js.onvopay.com/v1/" strategy="afterInteractive" onReady={() => setSdkReady(true)} />
    <p role={result?.status === "rejected" || result?.status === "unknown" ? "alert" : "status"} aria-live="polite"
      className={`min-w-0 flex-1 text-sm ${result?.status === "rejected" || result?.status === "unknown" ? "font-semibold text-red-800" : ""}`}>
      {result?.message ?? "Consultando el estado de tu pago..."}
      {result?.attemptsRemaining !== undefined ? ` ${result.attemptsRemaining} intentos disponibles.` : ""}
    </p>
    <div className="flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">
      {result?.status !== "paid" && result?.status !== "rejected" ? <Button disabled={busy || !result} onClick={pay} className="w-full whitespace-nowrap sm:w-auto">
        {busy ? "Verificando..." : result?.status === "action_required" ? "Verificar con mi banco" : "Pagar ahora"}
      </Button> : null}
      {result?.status === "rejected" ? <>
        <Button disabled={busy || result.attemptsRemaining === 0} onClick={pay} className="w-full whitespace-nowrap sm:w-auto">{busy ? "Verificando..." : "Intentar de nuevo"}</Button>
        <Button asChild variant="outline" className="w-full whitespace-nowrap sm:w-auto"><Link href={`/clerk-auth/onboarding/payment?business=${encodeURIComponent(businessId)}`}>Cambiar tarjeta</Link></Button>
      </> : null}
      <Button type="button" variant="outline" disabled={busy} onClick={refresh} className="w-full whitespace-nowrap sm:w-auto">Actualizar estado</Button>
    </div>
  </div>;

  return <div className="space-y-3">
    <Script src="https://js.onvopay.com/v1/" strategy="afterInteractive" onReady={() => setSdkReady(true)} />
    <p role={result?.status === "rejected" || result?.status === "unknown" ? "alert" : "status"} aria-live="polite"
      className={result?.status === "rejected" || result?.status === "unknown"
        ? "rounded-lg border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-800"
        : "text-sm text-slate-600"}>
      {result?.message ?? "Consultando el estado de tu pago..."}
    </p>
    {result?.attemptsRemaining !== undefined ? <p className="text-sm text-slate-600">
      {result.attemptsRemaining} intentos disponibles.
      {result.retryAt ? ` Podés volver a intentar después de ${new Date(result.retryAt).toLocaleString("es-CR")}.` : ""}
    </p> : null}
    {result?.status !== "paid" && result?.status !== "rejected" ? <Button className="w-full" disabled={busy || !result} onClick={pay}>
      {busy ? "Verificando..." : result?.status === "action_required" ? "Verificar con mi banco" : "Pagar y reactivar"}
    </Button> : null}
    {result?.status === "rejected" ? <>
      <Button className="w-full" disabled={busy || result.attemptsRemaining === 0} onClick={pay}>{busy ? "Verificando..." : "Intentar con la misma tarjeta"}</Button>
      <Button asChild variant="outline" className="w-full"><Link href={`/clerk-auth/onboarding/payment?business=${encodeURIComponent(businessId)}`}>Elegir o agregar otra tarjeta</Link></Button>
    </> : null}
    <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={refresh}>Actualizar estado</Button>
  </div>;
}
