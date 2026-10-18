"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { pollDomainPurchaseOutcome } from "../actions";

type Outcome = NonNullable<Awaited<ReturnType<typeof pollDomainPurchaseOutcome>>>;

export function PaymentProcessingClient({ purchase }: { purchase: string }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checking, setChecking] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let checks = 0;
    const check = async () => {
      try {
        const result = await pollDomainPurchaseOutcome(purchase);
        if (cancelled) return;
        if (!result) { setUnavailable(true); setChecking(false); return; }
        setOutcome(result);
        setChecking(false);
        if (result.paymentStatus === "captured" && result.domainStatus === "registered" || result.paymentStatus === "declined") {
          const status = result.paymentStatus === "declined" ? "failed" : "success";
          window.location.replace(`/admin/settings/domains?purchase=${encodeURIComponent(purchase)}&payment=${status}`);
          return;
        }
      } catch { if (!cancelled) setChecking(false); }
      if (!cancelled) timer = setTimeout(check, checks++ < 8 ? 2500 : 5000);
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [purchase]);
  return <main className="mx-auto grid max-w-xl gap-4 p-8"><h1 className="text-2xl font-semibold">Estado de la compra</h1><div className="rounded-xl border bg-card p-6"><div className="flex items-start gap-3">{!unavailable && (checking || !outcome || outcome.paymentStatus === "unknown" || outcome.paymentStatus === "authorized") ? <LoaderCircle className="mt-1 size-5 animate-spin text-primary" /> : null}<div><h2 className="font-semibold">{unavailable ? "Compra no disponible" : outcome?.title ?? "Estamos verificando tu pago"}</h2><p className="mt-2 text-sm text-muted-foreground">{unavailable ? "No encontramos esta compra para el negocio actual." : outcome?.message ?? "Consultamos el pago y el registro del dominio. Podés volver más tarde: el proceso seguirá en el servidor."}</p></div></div>{outcome ? <dl className="mt-5 grid gap-2 text-sm"><div><dt className="text-muted-foreground">Dominio</dt><dd>{outcome.domain}</dd></div><div><dt className="text-muted-foreground">Monto</dt><dd>{outcome.amount}</dd></div><div><dt className="text-muted-foreground">Referencia</dt><dd className="font-mono">{outcome.reference}</dd></div></dl> : null}</div><Link className="text-primary underline" href={`/admin/settings/domains?purchase=${encodeURIComponent(purchase)}`}>Ver detalles en Dominios</Link></main>;
}
