"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getUberDomainCardSetup, saveUberDomainCard } from "./actions";

export function UberDomainCardForm({ billingEmail, onCancel }: { billingEmail: string; onCancel: () => void }) {
  const router = useRouter();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [label, setLabel] = useState("");

  const save = async () => {
    if (submitting.current) return;
    const digits = number.replace(/\D/g, "");
    const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(expiry);
    if (!holder.trim() || !/^\d{13,19}$/.test(digits) || !match || !/^\d{3,4}$/.test(cvv)) {
      toast.error("Revisá los datos de la tarjeta."); return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const submissionKey = `domain-card-${crypto.randomUUID()}`;
      const setup = await getUberDomainCardSetup(submissionKey);
      if (!setup.success) throw new Error(setup.message);
      // PAN and CVV go directly from the browser to Onvo, never to Mediasis.
      const response = await fetch("https://api.onvopay.com/v1/payment-methods", {
        method: "POST", headers: { Authorization: `Bearer ${setup.publishableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "card", card: { number: digits, expMonth: Number(match[1]), expYear: 2000 + Number(match[2]), cvv, holderName: holder.trim() },
          billing: { name: holder.trim(), email: billingEmail, address: { country: setup.countryCode } },
          customer: { name: holder.trim(), email: billingEmail } }),
      });
      const method = await response.json().catch(() => null);
      if (!response.ok || !method?.id || !(method.customerId ?? method.customer?.id)) throw new Error(method?.message ?? "Onvo no pudo guardar la tarjeta.");
      const saved = await saveUberDomainCard({ paymentMethodId: method.id, customerId: method.customerId ?? method.customer.id, label: label.trim(), submissionKey });
      if (!saved.success) throw new Error(saved.message);
      setNumber(""); setExpiry(""); setCvv("");
      toast.success(saved.message);
      onCancel();
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar la tarjeta."); }
    finally { submitting.current = false; setBusy(false); }
  };

  return <div className="grid gap-3 rounded-lg border p-4">
    <p className="font-medium">Agregar tarjeta personal de IT</p>
    <p className="text-sm text-muted-foreground">Esta tarjeta será de tu cuenta de Mediasis y servirá para comprar dominios Uber. No cambia la tarjeta ni los cobros de la suscripción del negocio.</p>
    <Input value={label} onChange={(event) => setLabel(event.target.value.slice(0, 60))} placeholder="Nombre para reconocer la tarjeta (opcional)" maxLength={60} />
    <Input value={holder} onChange={(event) => setHolder(event.target.value)} placeholder="Nombre del titular" autoComplete="cc-name" />
    <Input value={number} onChange={(event) => setNumber(event.target.value.replace(/[^\d ]/g, "").slice(0, 24))} placeholder="Número de tarjeta" inputMode="numeric" autoComplete="cc-number" />
    <div className="grid grid-cols-2 gap-3"><Input value={expiry} onChange={(event) => { const digits = event.target.value.replace(/\D/g, "").slice(0, 4); setExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits); }} placeholder="MM/AA" inputMode="numeric" autoComplete="cc-exp" /><Input value={cvv} onChange={(event) => setCvv(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="CVV" inputMode="numeric" autoComplete="cc-csc" /></div>
    <p className="text-xs text-muted-foreground">Onvo tokeniza y verifica la tarjeta. Mediasis no recibe el número ni el CVV.</p>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar tarjeta"}</Button><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancelar</Button></div>
  </div>;
}
