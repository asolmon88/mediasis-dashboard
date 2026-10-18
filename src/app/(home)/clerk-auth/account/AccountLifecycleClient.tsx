"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { ArrowLeft, Building2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BillingCardManager } from "@/app/admin/settings/billing/billing-card-manager";
import { Button } from "@/components/ui/button";
import {
  acceptOwnershipTransfer, createTransferTilopaySdkToken, deleteDashboardAccess,
  getAccountLifecycleData, requestOwnershipTransfer,
} from "./actions";

type AccountData = Awaited<ReturnType<typeof getAccountLifecycleData>>;

function nameFromJoin(value: unknown): string {
  const record = Array.isArray(value) ? value[0] : value;
  return record && typeof record === "object" && "full_name" in record
    ? String(record.full_name) : "Negocio";
}

function memberLabel(value: unknown): string {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object") return "Miembro";
  const user = record as { display_name?: string | null; primary_email?: string | null };
  return user.display_name || user.primary_email || "Miembro";
}

export default function AccountLifecycleClient({ data }: { data: AccountData }) {
  const router = useRouter();
  const { openUserProfile, signOut } = useClerk();
  const { user } = useUser();
  const [pending, setPending] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [recipientByBusiness, setRecipientByBusiness] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
  }, [user?.firstName, user?.lastName]);

  const saveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      await user.update({ firstName: firstName.trim(), lastName: lastName.trim() });
      toast.success("Tus datos personales fueron actualizados.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron actualizar tus datos.");
    } finally {
      setSavingProfile(false);
    }
  };

  const requestTransfer = async (businessId: string) => {
    const recipient = recipientByBusiness[businessId];
    if (!recipient) return;
    setPending(true);
    const result = await requestOwnershipTransfer(businessId, recipient);
    setPending(false);
    if (result.success) { toast.success(result.message); router.refresh(); }
    else toast.error(result.message);
  };

  const accept = async (transferId: string, card?: { id: string; brand?: string; name?: string }) => {
    setPending(true);
    const result = await acceptOwnershipTransfer({
      transferId, cardToken: card?.id, brand: card?.brand, label: card?.name,
    });
    setPending(false);
    if (result.success) { router.refresh(); return result; }
    return result;
  };

  const removeDashboard = async () => {
    if (confirmation !== "ELIMINAR") return;
    setPending(true);
    const result = await deleteDashboardAccess();
    if (!result.success) { toast.error(result.message); setPending(false); return; }
    toast.success(result.message);
    await signOut({ redirectUrl: "/clerk-auth/sign-in" });
  };

  return <main className="min-h-[calc(100svh-4rem)] bg-muted/25 px-4 py-6 md:px-7 md:py-8">
    <div className="mx-auto max-w-5xl space-y-7">
      <Button variant="ghost" size="sm" asChild className="-ml-2 gap-2 text-muted-foreground hover:text-foreground">
        <Link href="/admin"><ArrowLeft className="size-4" />Volver al dashboard</Link>
      </Button>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b bg-gradient-to-r from-primary/[0.08] via-primary/[0.03] to-transparent px-6 py-7 md:px-8">
          <h1 className="text-2xl font-semibold tracking-tight">Tu cuenta de dashboard</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Administrá tu perfil, la propiedad de tus negocios y tu acceso.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 md:px-8">
          <div className="flex items-center gap-3 text-sm text-muted-foreground"><ShieldCheck className="size-5 text-primary" />Administrá tu perfil, contraseña y seguridad desde el centro de cuenta.</div>
          <Button variant="outline" onClick={() => openUserProfile()}>Administrar perfil y seguridad</Button>
        </div>
        <div className="grid gap-3 border-t bg-muted/20 px-6 py-5 md:grid-cols-[1fr_1fr_auto] md:items-end md:px-8">
          <label className="grid gap-1.5 text-sm font-medium">Nombre
            <input className="h-10 rounded-md border bg-background px-3 font-normal" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">Apellido
            <input className="h-10 rounded-md border bg-background px-3 font-normal" value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" />
          </label>
          <Button onClick={() => void saveProfile()} disabled={savingProfile || !user}>{savingProfile ? "Guardando…" : "Guardar datos"}</Button>
        </div>
      </section>

    {data.incoming.length > 0 ? <section className="space-y-4">
      <div className="flex items-center gap-2"><Building2 className="size-5 text-primary" /><h2 className="text-lg font-semibold">Transferencias para aceptar</h2></div>
      {data.incoming.map((transfer) => <div key={transfer.transfer_id} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="font-medium">{nameFromJoin(transfer.businesses)}</h3>
        {transfer.subscription ? <>
          <p className="text-sm text-muted-foreground">Este negocio tiene una suscripción de {transfer.subscription.currency_code} {(Number(transfer.subscription.amount_minor) / 100).toFixed(2)} por {transfer.subscription.billing_cadence === "annual" ? "año" : "mes"}. Al aceptarla, la próxima renovación se cobrará a tu tarjeta; no empieza una prueba nueva.</p>
          <BillingCardManager
            canManage billingEmail={data.email} currency={transfer.subscription.currency_code}
            requireRecurringConsent
            createSession={createTransferTilopaySdkToken}
            consentDescription="Acepto la propiedad de este negocio y autorizo los cobros recurrentes del plan indicado a mi tarjeta desde la próxima fecha de cobro. Puedo cancelar futuras renovaciones en Facturación."
            onCardSelected={(card) => accept(transfer.transfer_id, { id: card.id, brand: card.brand, name: card.name })}
          />
        </> : <Button disabled={pending} onClick={async () => {
          const result = await accept(transfer.transfer_id);
          if (result.success) toast.success(result.message); else toast.error(result.message);
        }}>Aceptar propiedad</Button>}
      </div>)}
    </section> : null}

    <section className="space-y-4">
      <div className="flex items-center gap-2"><Building2 className="size-5 text-primary" /><h2 className="text-lg font-semibold">Negocios a tu nombre</h2></div>
      {data.owned.length ? data.owned.map((owner) => <div key={owner.business_id} className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="font-medium">{nameFromJoin(owner.businesses)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">Si eliminás tu acceso sin transferirlo, este negocio se cerrará y no recibirá pedidos nuevos.</p>
        {owner.pending ? <p className="mt-3 text-sm">Transferencia pendiente de aceptación.</p> : owner.members.length ? <div className="mt-4 flex flex-wrap gap-2">
          <select
            aria-label={`Nuevo propietario de ${nameFromJoin(owner.businesses)}`}
            className="h-10 min-w-48 rounded-md border bg-background px-3"
            value={recipientByBusiness[owner.business_id] ?? ""}
            onChange={(event) => setRecipientByBusiness((current) => ({ ...current, [owner.business_id]: event.target.value }))}
          >
            <option value="">Elegí un miembro activo</option>
            {owner.members.map((member) => <option key={member.app_user_id} value={member.app_user_id}>{memberLabel(member.app_users)}</option>)}
          </select>
          <Button variant="outline" disabled={pending || !recipientByBusiness[owner.business_id]} onClick={() => void requestTransfer(owner.business_id)}>Solicitar transferencia</Button>
        </div> : <p className="mt-3 text-sm text-muted-foreground">No hay otro miembro activo para transferir la propiedad.</p>}
      </div>) : <p className="text-sm text-muted-foreground">No tenés negocios a tu nombre.</p>}
    </section>

    <section className="space-y-3 rounded-2xl border border-destructive/40 bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Eliminar acceso al dashboard</h2>
      <p className="text-sm text-muted-foreground">Se cerrarán de inmediato los negocios que sigan a tu nombre y se detendrán sus próximas renovaciones. Los pedidos y comprobantes históricos se conservan. Tu cuenta de pedidos, si la usás, seguirá disponible.</p>
      <label className="block text-sm" htmlFor="confirm-dashboard-delete">Escribí ELIMINAR para confirmar</label>
      <input id="confirm-dashboard-delete" className="h-10 w-full max-w-xs rounded-md border bg-background px-3" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      <div><Button variant="destructive" disabled={pending || confirmation !== "ELIMINAR"} onClick={() => void removeDashboard()}>{pending ? "Procesando…" : "Eliminar mi acceso al dashboard"}</Button></div>
    </section>
    </div>
  </main>;
}
