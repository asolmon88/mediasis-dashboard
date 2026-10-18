"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, CreditCard, ExternalLink, Landmark, Plus, RefreshCw } from "lucide-react";
import { enableElectronicPaymentMethod, refreshElectronicPaymentSetup, saveManualPaymentMethod, startElectronicPaymentSetup, updateApplePayDomain } from "@/app/admin/app/payment-methods/actions";
import type { ApplePayDomainStatus } from "@/lib/onvo/apple-pay-domains";
import { payment_methods_for_table } from "@/lib/types/dashboardTypes";
import { PaymentMethodsTable } from "./PaymentMethodsTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type MainPageProps = {
  paymentMethods: payment_methods_for_table;
  canManageAllLocations: boolean;
  paymentMethodsManagedByMediasis: boolean;
  countryCode: string | null;
  marketplaceConnection: {
    status: string;
    hasConnectedAccount: boolean;
    onboardingUrl: string | null;
    lastError: string | null;
  } | null;
  applePayDomains: ApplePayDomainStatus[];
  canManageApplePay: boolean;
};

type ElectronicMethod = "card" | "sinpe";

export default function MainPage({ paymentMethods, canManageAllLocations, paymentMethodsManagedByMediasis, countryCode, marketplaceConnection, applePayDomains, canManageApplePay }: MainPageProps) {
  const [open, setOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [requestedMethod, setRequestedMethod] = useState<ElectronicMethod | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [connection, setConnection] = useState(marketplaceConnection);
  const [settingUp, setSettingUp] = useState(false);
  const [domainStatuses, setDomainStatuses] = useState(applePayDomains);
  const [updatingHostname, setUpdatingHostname] = useState<string | null>(null);
  const [payeeName, setPayeeName] = useState(paymentMethods.find((method) => method.is_manual)?.payee_name ?? "");
  const [instructions, setInstructions] = useState(paymentMethods.find((method) => method.is_manual)?.instructions ?? "");
  const [saving, setSaving] = useState(false);
  const hasManual = paymentMethods.some((method) => method.is_manual);
  const savedPayeeName = paymentMethods.find((method) => method.is_manual)?.payee_name ?? "";
  const savedInstructions = paymentMethods.find((method) => method.is_manual)?.instructions ?? "";
  const manualDirty = payeeName !== savedPayeeName || instructions !== savedInstructions;
  const isCostaRica = countryCode?.toUpperCase() === "CR";
  const hasCard = paymentMethods.some((method) => /^(card|tarjeta)$/i.test(method.name.trim()));
  const hasSinpe = paymentMethods.some((method) => /^(sinpe|simpe)\s*(m[oó]vil|mobile)?$/i.test(method.name.trim()));
  const connectionLabel = useMemo(() => {
    if (!connection) return null;
    if (connection.status === "active") return "Tu cuenta de cobros está activa.";
    if (connection.status === "awaiting_approval") return "Tu solicitud está en revisión.";
    if (connection.status === "pending_onboarding") return "Completá el onboarding para activar los cobros.";
    if (connection.status === "suspended" || connection.status === "inactive") return "Tu cuenta de cobros no está activa por ahora.";
    return "Estamos preparando tu cuenta de cobros.";
  }, [connection]);
  const discardManual = () => {
    setPayeeName(savedPayeeName);
    setInstructions(savedInstructions);
  };
  const saveManual = async () => {
    setSaving(true);
    const result = await saveManualPaymentMethod({ payeeName, instructions });
    setSaving(false);
    if (!result.success) return toast.error(result.message);
    toast.success(hasManual ? "Método Manual actualizado." : "Método Manual agregado.");
    setOpen(false);
    window.location.reload();
  };
  const openElectronicSetup = (method: ElectronicMethod) => {
    setRequestedMethod(method);
    setAcceptedTerms(false);
    setSetupOpen(true);
  };
  const copyOnboardingLink = async () => {
    if (!connection?.onboardingUrl) return;
    try {
      await navigator.clipboard.writeText(connection.onboardingUrl);
      toast.success("Enlace copiado.");
    } catch { toast.error("No se pudo copiar el enlace."); }
  };
  const startSetup = async () => {
    if (!requestedMethod) return;
    setSettingUp(true);
    const result = await startElectronicPaymentSetup({ method: requestedMethod, acceptedTerms });
    setSettingUp(false);
    if (!result.success) return toast.error(result.message);
    setConnection(result.connection);
    toast.success("Cuenta de cobros preparada.");
  };
  const refreshSetup = async (regenerate = false) => {
    setSettingUp(true);
    const result = await refreshElectronicPaymentSetup({ regenerate });
    setSettingUp(false);
    if (!result.success) return toast.error(result.message);
    setConnection(result.connection);
    toast.success(regenerate ? "Enlace regenerado." : "Estado actualizado.");
  };
  const enableMethod = async () => {
    if (!requestedMethod) return;
    setSettingUp(true);
    const result = await enableElectronicPaymentMethod({ method: requestedMethod });
    setSettingUp(false);
    if (!result.success) return toast.error(result.message);
    toast.success(`${requestedMethod === "card" ? "Tarjeta" : "SINPE Móvil"} activado.`);
    setSetupOpen(false);
    window.location.reload();
  };
  const updateDomain = async (domain: ApplePayDomainStatus, action: "register" | "refresh" | "validate") => {
    setUpdatingHostname(domain.hostname);
    const result = await updateApplePayDomain({ domainId: domain.storefrontDomainId, hostname: domain.hostname, action });
    setUpdatingHostname(null);
    if (!result.success) return toast.error(result.message);
    setDomainStatuses(result.domains);
    toast.success("Estado de Apple Pay actualizado.");
  };
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Métodos de pago</h1>
        <p className="text-sm text-muted-foreground">
          Administra visibilidad y disponibilidad por ubicación de tus métodos de pago.
        </p>
      </div>

      {paymentMethodsManagedByMediasis ? <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">Los métodos de pago de tu plan Uber son configurados por Mediasis.</p> : <div className="flex flex-wrap justify-end gap-2">
        {isCostaRica ? <>
          {!hasCard ? <Button variant="outline" onClick={() => openElectronicSetup("card")}><CreditCard className="mr-2 size-4" />Agregar tarjeta</Button> : null}
          {!hasSinpe ? <Button variant="outline" onClick={() => openElectronicSetup("sinpe")}><Landmark className="mr-2 size-4" />Agregar SINPE Móvil</Button> : null}
        </> : null}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 size-4" />{hasManual ? "Editar método Manual" : "Agregar método Manual"}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{hasManual ? "Editar método Manual" : "Agregar método Manual"}</DialogTitle><DialogDescription>Configurá cómo tus clientes realizan y confirman este pago.</DialogDescription></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2"><Label htmlFor="manual-payee">Nombre del beneficiario</Label><Input id="manual-payee" value={payeeName} onChange={(event) => setPayeeName(event.target.value)} placeholder="Nombre o cuenta a la que se paga" /></div>
              <div className="space-y-2"><Label htmlFor="manual-instructions">Instrucciones de pago</Label><Textarea id="manual-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Indicá a tu cliente cómo realizar el pago." rows={5} /></div>
            </div>
            <DialogFooter className="sm:justify-start">
              {manualDirty ? <Button type="button" variant="outline" disabled={saving} onClick={discardManual}>Descartar cambios</Button> : null}
              <Button disabled={saving || !manualDirty || !payeeName.trim() || !instructions.trim()} onClick={() => void saveManual()}>{saving ? "Guardando..." : "Guardar método"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{requestedMethod === "card" ? "Activar pagos con tarjeta" : "Activar SINPE Móvil"}</DialogTitle>
              <DialogDescription>Onvo procesa estos cobros para tu negocio. Mediasis te ofrece la plataforma de pagos.</DialogDescription>
            </DialogHeader>
            {!connection ? <div className="space-y-4 py-2">
              <div className="rounded-lg border bg-muted/40 p-4 text-sm space-y-2">
                <p><strong>Tarjeta:</strong> 5% + US$0.25 equivalente por transacción.</p>
                <p><strong>SINPE Móvil:</strong> 3.5% por transacción.</p>
                <p className="text-muted-foreground">Crearemos una sola cuenta de cobros para este negocio. Luego podrás activar tarjeta y SINPE Móvil desde la misma cuenta.</p>
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
                <span>Entiendo las comisiones indicadas y autorizo iniciar la configuración de pagos electrónicos para este negocio.</span>
              </label>
            </div> : <div className="space-y-4 py-2">
              <div className="rounded-lg border p-4 space-y-1">
                <p className="font-medium">Estado de la cuenta de cobros</p>
                <p className="text-sm text-muted-foreground">{connectionLabel}</p>
                {connection.lastError ? <p className="text-sm text-destructive">No se pudo completar una solicitud anterior. Intentá de nuevo o contactá a Mediasis.</p> : null}
              </div>
              {connection.onboardingUrl && connection.status !== "active" ? <div className="rounded-lg border border-dashed p-4 space-y-3">
                <p className="text-sm">Completá el onboarding con el enlace seguro. El enlace puede vencer; podés regenerarlo cuando lo necesités.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" asChild><a href={connection.onboardingUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 size-4" />Abrir onboarding</a></Button>
                  <Button type="button" variant="outline" onClick={() => void copyOnboardingLink()}><Copy className="mr-2 size-4" />Copiar enlace</Button>
                  <Button type="button" variant="outline" disabled={settingUp} onClick={() => void refreshSetup(true)}><RefreshCw className="mr-2 size-4" />Regenerar enlace</Button>
                </div>
              </div> : null}
              {connection.status !== "active" ? <Button type="button" variant="outline" disabled={settingUp} onClick={() => void refreshSetup()}><RefreshCw className="mr-2 size-4" />Actualizar estado</Button> : null}
              {connection.status === "failed" ? <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} />
                <span>Confirmo que deseo volver a solicitar la configuración de pagos electrónicos.</span>
              </label> : null}
              {connection.status === "active" ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">Tu cuenta está activa. Ya podés habilitar {requestedMethod === "card" ? "pagos con tarjeta" : "SINPE Móvil"}.</div> : null}
            </div>}
            <DialogFooter className="sm:justify-start">
              {!connection ? <Button disabled={settingUp || !acceptedTerms} onClick={() => void startSetup()}>{settingUp ? "Preparando..." : "Continuar"}</Button> : null}
              {connection?.status === "failed" ? <Button disabled={settingUp || !acceptedTerms} onClick={() => void startSetup()}>{settingUp ? "Preparando..." : "Intentar nuevamente"}</Button> : null}
              {connection?.status === "active" ? <Button disabled={settingUp} onClick={() => void enableMethod()}>{settingUp ? "Activando..." : `Activar ${requestedMethod === "card" ? "tarjeta" : "SINPE Móvil"}`}</Button> : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>}
      <PaymentMethodsTable paymentMethods={paymentMethods} canManageAllLocations={canManageAllLocations} readOnly={paymentMethodsManagedByMediasis} />
      {domainStatuses.length > 0 ? <section className="rounded-xl border bg-card p-4 space-y-3" aria-labelledby="apple-pay-title">
        <div><h2 id="apple-pay-title" className="font-semibold">Apple Pay en tus dominios</h2><p className="text-sm text-muted-foreground">Cada dirección donde se muestre Apple Pay debe verificarse por separado.</p></div>
        {domainStatuses.map((domain) => <div key={domain.hostname} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><p className="break-all font-medium">{domain.hostname}</p>
            <p className="text-sm text-muted-foreground">{domain.state === "active" ? `Dominio verificado por ONVO · ${domain.mode}` : domain.state === "unavailable" ? "La cuenta ONVO todavía no está lista" : domain.state === "inactive" ? "Requiere validación" : domain.state === "disabled" ? "Deshabilitado en ONVO" : domain.state === "not_registered" ? "Aún no registrado" : "Verificación pendiente"}</p>
            {domain.error ? <p className="text-sm text-destructive">{domain.error}</p> : null}
          </div>
          {canManageApplePay && domain.state !== "unavailable" ? <div className="flex shrink-0 flex-wrap gap-2">
            {domain.state === "not_registered" ? <Button size="sm" disabled={updatingHostname === domain.hostname} onClick={() => void updateDomain(domain, "register")}>Registrar</Button> : <>
              <Button size="sm" variant="outline" disabled={updatingHostname === domain.hostname} onClick={() => void updateDomain(domain, "refresh")}>Actualizar estado</Button>
              {domain.state === "inactive" ? <Button size="sm" disabled={updatingHostname === domain.hostname || Boolean(domain.lastValidationAt && Date.now() - new Date(domain.lastValidationAt).getTime() < 60_000)} onClick={() => void updateDomain(domain, "validate")}>Reintentar validación</Button> : null}
            </>}
          </div> : null}
        </div>)}
      </section> : null}
    </div>
  );
}
