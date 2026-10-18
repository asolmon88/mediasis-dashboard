"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Circle, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { authorizeOnvoDomainPurchase, beginOnvoDomainPurchase, refreshDomainSetup, removeUberDomainCard, searchDomains, setPrimaryDomain } from "./actions";
import { calculateDomainPurchasePrice } from "@/lib/domains/pricing";
import { UberDomainCardForm } from "./uber-domain-card-form";

type Offer = { domain: string; priceMinor: number; registrationYears: number };
type SavedCard = { id: string; brand: string | null; label: string | null; last4: string | null };
type Domain = {
  storefront_domain_id: string;
  apex_domain: string;
  source: "purchased" | "external";
  verification_status: string;
  is_primary: boolean;
  disconnected_at: string | null;
  expires_at: string | null;
  last_error: string | null;
};
type PendingPurchase = { domain: string; state: string; orderNumber: string | null; hasIntent: boolean };

const pendingPurchaseCopy: Record<string, { title: string; description: string }> = {
  created: { title: "Preparando tu compra", description: "Estamos preparando la autorización de tu pago." },
  authorization_pending: { title: "Confirmando tu pago", description: "Onvo está confirmando la autorización. No enviés otra compra." },
  authorized: { title: "Pago autorizado", description: "Estamos registrando tu dominio. Capturaremos el pago cuando el registro termine." },
  registering: { title: "Registrando tu dominio", description: "Cloudflare está registrando el dominio. Puede tomar unos minutos." },
  registration_pending: { title: "Registro en proceso", description: "El registro todavía está siendo confirmado. Te avisaremos cuando esté listo." },
  capture_failed: { title: "Compra en revisión", description: "El registro terminó, pero debemos confirmar el cobro antes de finalizar la compra." },
};

const domainStatusCopy: Record<string, string> = {
  active: "Activo",
  dns_pending: "Esperando DNS",
  vercel_pending: "Configurando app",
  clerk_pending: "Verificando acceso",
  failed: "Requiere atención",
  disconnected: "Desconectado",
};

const contactSchema = z.object({
  firstName: z.string().trim().min(1, "Ingresá el nombre."),
  lastName: z.string().trim().min(1, "Ingresá los apellidos."),
  email: z.string().trim().email("Ingresá un correo válido."),
  phone: z.string().trim().min(6, "Ingresá un teléfono válido."),
  address: z.string().trim().min(3, "Ingresá la dirección."),
  city: z.string().trim().min(2, "Ingresá la ciudad."),
  state: z.string().trim().min(2, "Ingresá la provincia o estado."),
  country: z.string().length(2),
  postalCode: z.string().trim().min(2, "Ingresá el código postal."),
});

export function DomainManager({ initialDomains, canManage, billingEmail, payerEmail, staffManagedUber, walletCards, selectedCardId, attemptsRemaining, retryAt, pendingPurchase }: {
  initialDomains: Domain[];
  canManage: boolean;
  billingEmail: string;
  payerEmail: string;
  staffManagedUber: boolean;
  walletCards: SavedCard[];
  selectedCardId: string | null;
  attemptsRemaining: number;
  retryAt: string | null;
  purchaseOutcome: unknown;
  pendingPurchase: PendingPurchase | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prefix, setPrefix] = useState("");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [purchase, setPurchase] = useState<{ orderNumber: string; amount: string; domain: string } | null>(null);
  const [selectedSavedCard, setSelectedSavedCard] = useState<string | null>(selectedCardId);
  const [addingStaffCard, setAddingStaffCard] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const paymentSubmissionRef = useRef(false);
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: billingEmail, phone: "", address: "", city: "", state: "", country: "CR", postalCode: "" });

  useEffect(() => {
    if (!canManage || pendingPurchase) return;
    startTransition(async () => {
      const result = await searchDomains();
      if (result.success) setOffers(result.offers);
    });
  }, [canManage]);

  const search = () => startTransition(async () => {
    const result = await searchDomains(prefix);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    setOffers(result.offers);
    if (!result.offers.length) toast.message(result.message ?? "No encontramos dominios disponibles.");
  });
  const prepare = () => {
    if (!offer) return;
    const parsed = contactSchema.safeParse(contact);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Revisá los datos.");
    startTransition(async () => {
      const result = await beginOnvoDomainPurchase(offer.domain, parsed.data);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      setPurchase(result);
      setSelectedSavedCard(selectedCardId);
      toast.success(result.message);
    });
  };
  const runAuthorization = (orderNumber: string, cardId: string) => {
    if (paymentSubmissionRef.current) return;
    paymentSubmissionRef.current = true;
    startTransition(async () => {
      try {
        let result = await authorizeOnvoDomainPurchase(orderNumber, cardId);
        if ("nextAction" in result && result.nextAction?.type === "3ds") {
          if (!sdkReady || !window.ONVO) {
            toast.error("No cargó la autenticación bancaria. Recargá la página y retomá este mismo pago.");
            router.refresh();
            return;
          }
          try {
            await window.ONVO(result.nextAction.publishableKey).handleNextAction({ paymentIntentId: result.nextAction.paymentIntentId });
          } catch {
            // Closing or failing the prompt is not a payment result. Read the same intent.
          }
          result = await authorizeOnvoDomainPurchase(orderNumber, "");
        }
        if (result.success) { toast.success(result.message); setPurchase(null); }
        else toast.error(result.message);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo verificar la autorización.");
      } finally {
        paymentSubmissionRef.current = false;
      }
    });
  };
  const authorize = () => { if (purchase && selectedSavedCard) runAuthorization(purchase.orderNumber, selectedSavedCard); };
  const refreshDomain = (domainId: string) => startTransition(async () => {
    const result = await refreshDomainSetup(domainId);
    result.success ? toast.success(result.message) : toast.error(result.message);
    if (result.success) router.refresh();
  });
  const makePrimary = (domainId: string) => startTransition(async () => {
    const result = await setPrimaryDomain(domainId);
    result.success ? toast.success(result.message) : toast.error(result.message);
    if (result.success) router.refresh();
  });
  const removeStaffCard = (cardId: string) => startTransition(async () => {
    const result = await removeUberDomainCard(cardId);
    if (!result.success) { toast.error(result.message); return; }
    if (selectedSavedCard === cardId) setSelectedSavedCard(null);
    toast.success(result.message);
    router.refresh();
  });

  const pendingDetails = pendingPurchase ? pendingPurchaseCopy[pendingPurchase.state] ?? { title: "Compra en proceso", description: "Estamos procesando tu compra. No iniciés otra hasta que termine." } : null;

  return <div className="grid gap-6">
    <Script src="https://js.onvopay.com/v1/" strategy="afterInteractive" onReady={() => setSdkReady(true)} />
    <Card><CardHeader><CardTitle>Dominio activo</CardTitle><CardDescription>Solo una dirección está activa en la app de pedidos.</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">{initialDomains.find((domain) => domain.is_primary)?.apex_domain ?? "Todavía no hay un dominio activo."}{" · "}{initialDomains.filter((domain) => !domain.disconnected_at).length}/3 dominios guardados</CardContent></Card>
    {staffManagedUber && !purchase ? <Card><CardHeader><CardTitle>Mis tarjetas para dominios Uber</CardTitle><CardDescription>Estas tarjetas pertenecen a tu cuenta de IT, no al negocio. Podés usarlas para comprar dominios administrados por Mediasis.</CardDescription></CardHeader><CardContent className="grid gap-3">{walletCards.map((card) => <div key={card.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span>{card.label || card.brand || "Tarjeta"} · {card.brand ?? "Tarjeta"} •••• {card.last4 ?? ""}</span><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => removeStaffCard(card.id)}>Quitar de mi cuenta</Button></div>)}{!walletCards.length ? <p className="text-sm text-muted-foreground">Todavía no tenés tarjetas para dominios.</p> : null}{addingStaffCard ? <UberDomainCardForm billingEmail={payerEmail} onCancel={() => setAddingStaffCard(false)} /> : <Button type="button" variant="outline" className="w-fit" disabled={walletCards.length >= 3 || attemptsRemaining === 0} onClick={() => setAddingStaffCard(true)}>Agregar tarjeta a mi cuenta de IT</Button>}</CardContent></Card> : null}
    {initialDomains.filter((domain) => !domain.disconnected_at).length ? <Card><CardHeader><CardTitle>Dominios guardados</CardTitle><CardDescription>El estado del registro y de la conexión con tu app de pedidos.</CardDescription></CardHeader><CardContent className="grid gap-3">{initialDomains.filter((domain) => !domain.disconnected_at).map((domain) => <div key={domain.storefront_domain_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><p className="font-medium">{domain.apex_domain}{domain.is_primary ? <span className="ml-2 text-sm font-normal text-primary">Dominio activo</span> : null}</p><p className="mt-1 text-sm text-muted-foreground">{domain.source === "purchased" ? "Registrado con Mediasis" : "Dominio externo"} · {domainStatusCopy[domain.verification_status] ?? domain.verification_status}</p>{domain.last_error ? <p className="mt-1 text-sm text-destructive">{domain.last_error}</p> : null}</div>{canManage ? <div className="flex flex-wrap gap-2">{domain.verification_status !== "active" ? <Button type="button" variant="outline" onClick={() => refreshDomain(domain.storefront_domain_id)} disabled={pending}>Actualizar</Button> : null}{domain.verification_status === "active" && !domain.is_primary ? <Button type="button" variant="outline" onClick={() => makePrimary(domain.storefront_domain_id)} disabled={pending}>Usar como activo</Button> : null}</div> : null}</div>)}</CardContent></Card> : null}
    {pendingPurchase && pendingDetails ? <Card className="border-primary/40" aria-live="polite"><CardHeader><CardTitle>{pendingDetails.title}</CardTitle><CardDescription>Compra de {pendingPurchase.domain}</CardDescription></CardHeader><CardContent className="grid gap-4"><p className="text-sm text-muted-foreground">{pendingDetails.description}</p><p className="text-sm text-muted-foreground">No podés iniciar otra compra de dominio mientras esta esté en proceso.</p><div className="flex flex-wrap gap-2">{canManage && pendingPurchase.state === "authorization_pending" && pendingPurchase.hasIntent && pendingPurchase.orderNumber ? <Button type="button" onClick={() => runAuthorization(pendingPurchase.orderNumber!, "")} disabled={pending}>{pending ? "Verificando…" : "Verificar con mi banco"}</Button> : null}<Button type="button" variant="outline" className="w-fit" onClick={() => router.refresh()} disabled={pending}><RefreshCw className={pending ? "animate-spin" : undefined} />Recargar estado</Button></div></CardContent></Card> : null}
    {canManage && !pendingPurchase ? <Card><CardHeader><CardTitle>Comprar dominio</CardTitle><CardDescription>Onvo autoriza el pago y Mediasis lo captura únicamente después de completar el registro.</CardDescription></CardHeader><CardContent className="grid gap-5">
      <div className="flex max-w-md items-center"><Input value={prefix} onChange={(event) => setPrefix(event.target.value.replace(/[^a-zA-Z0-9-]/g, ""))} className="rounded-r-none text-right" placeholder="tunegocio" /><span className="rounded-r-md border border-l-0 bg-muted px-3 py-2 text-sm text-muted-foreground">express.app</span><Button type="button" className="ml-2" variant="outline" onClick={search} disabled={pending}><Search />Buscar</Button></div>
      {offers.length ? <div className="divide-y rounded-lg border">{offers.map((item) => <div key={item.domain} className="flex items-center justify-between gap-3 p-4"><div><p className="font-medium">{item.domain}</p><p className="text-sm text-muted-foreground">{item.registrationYears} año</p></div><Button type="button" onClick={() => { setOffer(item); setPurchase(null); }}>Comprar por US${(calculateDomainPurchasePrice(item.priceMinor).totalMinor / 100).toFixed(2)}</Button></div>)}</div> : null}
      {offer && !purchase ? <div className="grid gap-3 rounded-lg border p-4"><div><p className="font-medium">{offer.domain}</p><p className="text-sm text-muted-foreground">Datos de facturación y comprobante</p></div><div className="grid gap-2 sm:grid-cols-2"><Input placeholder="Nombre" value={contact.firstName} onChange={(event) => setContact({ ...contact, firstName: event.target.value })} /><Input placeholder="Apellidos" value={contact.lastName} onChange={(event) => setContact({ ...contact, lastName: event.target.value })} /><Input type="email" placeholder="Correo" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /><PhoneInput defaultCountry="CR" placeholder="Teléfono" value={contact.phone} onChange={(phone) => setContact({ ...contact, phone })} /><Input placeholder="Dirección" value={contact.address} onChange={(event) => setContact({ ...contact, address: event.target.value })} /><Input placeholder="Ciudad" value={contact.city} onChange={(event) => setContact({ ...contact, city: event.target.value })} /><Input placeholder="Provincia o estado" value={contact.state} onChange={(event) => setContact({ ...contact, state: event.target.value })} /><Select value={contact.country} onValueChange={(country) => setContact({ ...contact, country })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CR">Costa Rica</SelectItem><SelectItem value="PA">Panamá</SelectItem><SelectItem value="US">Estados Unidos</SelectItem></SelectContent></Select><Input placeholder="Código postal" value={contact.postalCode} onChange={(event) => setContact({ ...contact, postalCode: event.target.value })} /></div><Button type="button" onClick={prepare} disabled={pending}>Continuar por US${(calculateDomainPurchasePrice(offer.priceMinor).totalMinor / 100).toFixed(2)}</Button></div> : null}
      {purchase ? <div className="grid gap-4 rounded-lg border p-4"><div><p className="font-medium">Autorizar US${purchase.amount} para {purchase.domain}</p><p className="text-sm text-muted-foreground">{staffManagedUber ? "Elegí una tarjeta de tu cuenta de IT. No se usará la tarjeta del negocio." : "Elegí una tarjeta antes de autorizar la compra."}</p></div><p className={retryAt ? "rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800" : "text-sm text-muted-foreground"}>{attemptsRemaining} intentos disponibles.{retryAt ? ` Podés volver a intentar después de ${new Date(retryAt).toLocaleString("es-CR")}.` : ""}</p>{walletCards.length ? walletCards.map((card) => <button key={card.id} type="button" onClick={() => setSelectedSavedCard(card.id)} className={selectedSavedCard === card.id ? "flex w-full items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 p-4 text-left" : "flex w-full items-center gap-3 rounded-lg border p-4 text-left"} aria-pressed={selectedSavedCard === card.id}>{selectedSavedCard === card.id ? <CheckCircle2 className="size-5 shrink-0 text-primary" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}<span><span className="block font-medium">{card.label || [card.brand ?? "Tarjeta", "guardada"].join(" ")}</span><span className="mt-1 block text-sm text-muted-foreground">{card.brand ?? "Tarjeta"} •••• {card.last4 ?? ""} · Guardada</span></span></button>) : <p className="rounded-lg border p-4 text-sm text-muted-foreground">{staffManagedUber ? "Agregá una tarjeta a tu cuenta de IT para comprar el dominio." : "Agregá una tarjeta en Facturación antes de comprar el dominio."}</p>}{selectedSavedCard ? <p className="text-sm text-muted-foreground">Se usará esta tarjeta para la compra.</p> : null}{staffManagedUber ? addingStaffCard ? <UberDomainCardForm billingEmail={payerEmail} onCancel={() => setAddingStaffCard(false)} /> : <Button type="button" variant="outline" className="w-fit" disabled={walletCards.length >= 3 || attemptsRemaining === 0} onClick={() => setAddingStaffCard(true)}>Agregar tarjeta a mi cuenta de IT</Button> : <Button type="button" variant="outline" className="w-fit" onClick={() => window.location.assign("/admin/settings/billing")}>Agregar otra tarjeta</Button>}<Button type="button" onClick={authorize} disabled={!selectedSavedCard || attemptsRemaining === 0 || pending}>{pending ? "Autorizando…" : "Autorizar compra"}</Button></div> : null}
    </CardContent></Card> : null}
  </div>;
}
