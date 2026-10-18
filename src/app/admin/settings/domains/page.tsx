import { Card, CardContent } from "@/components/ui/card";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireDomainAccess } from "@/lib/dashboard/domain-authorization";
import { getBillingProfile } from "../billing/actions";
import { DomainManager } from "./domain-manager";
import { getDomainPurchaseOutcome, getStorefrontDomains } from "./actions";

export default async function DomainsPage({ searchParams }: { searchParams?: Promise<{ purchase?: string }> }) {
  const authorized = await requireDomainAccess();
  if (!authorized.success) return <DashboardAccessDenied title="Dominios no disponibles" description={authorized.message} />;
  const { data: storefrontLink } = await authorized.admin.schema("mediasis").from("business_domain")
    .select("base_domain_slug")
    .eq("business_uid", authorized.businessId)
    .eq("is_internal_storefront", true)
    .maybeSingle();
  const linkCard = storefrontLink?.base_domain_slug ? <Card><CardContent className="py-5"><p className="text-sm font-medium">Link de tu app de pedidos</p><a className="mt-1 block break-all text-blue-600 underline" href={`https://www.mediasis.cr/${storefrontLink.base_domain_slug}`} target="_blank" rel="noreferrer">{`mediasis.cr/${storefrontLink.base_domain_slug}`}</a><p className="mt-2 text-sm text-muted-foreground">Compartilo con tus clientes. No necesitás comprar un dominio para usarlo.</p></CardContent></Card> : null;
  if (authorized.mediasisManaged && !authorized.canManage) {
    const { data } = await authorized.admin
      .schema("mediasis")
      .from("business_domain")
      .select("domain")
      .eq("business_uid", authorized.businessId)
      .eq("type", "order_app")
      .eq("is_internal_storefront", false)
      .maybeSingle();
    return <main className="mx-auto grid w-full max-w-4xl gap-6 p-4 md:p-8"><div><h1 className="text-2xl font-semibold">Dominios</h1><p className="mt-1 text-sm text-muted-foreground">La dirección de tu app de pedidos.</p></div>{linkCard}<Card><CardContent className="grid gap-4 py-6"><div><p className="text-sm font-medium">Dominio activo</p><p className="mt-1 text-lg font-semibold">{data?.domain ?? "No hay un dominio activo"}</p></div><p className="rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground">Tu plan {authorized.planKey === "uber_porcentaje" ? "mediasis Uber Porcentaje" : "mediasis Uber Fijo"} incluye la administración del dominio por parte del equipo de Mediasis. Contactanos si necesitás cambiarlo.</p></CardContent></Card></main>;
  }
  const result = await getStorefrontDomains();
  if (!result.success) return <DashboardAccessDenied title="Dominios no disponibles" description={result.message} />;
  const billing = await getBillingProfile();
  const purchaseOutcome = await getDomainPurchaseOutcome((await searchParams)?.purchase);
  const { data: market } = await authorized.admin.schema("mediasis").from("business_market_settings")
    .select("country_code").eq("business_id", authorized.businessId).maybeSingle();
  const { data: walletCards } = authorized.context.appUserId ? await authorized.admin.schema("mediasis")
    .from("platform_billing_owner_cards").select("owner_card_id,card_brand,card_label,card_last4")
    .eq("owner_app_user_id", authorized.context.appUserId).eq("country_code", market?.country_code ?? "CR")
    .is("removed_at", null).order("created_at", { ascending: true }) : { data: [] };
  const { data: selection } = await authorized.admin.schema("mediasis").from("platform_billing_business_card_selections")
    .select("owner_card_id").eq("business_id", authorized.businessId).maybeSingle();
  const [{ data: submissions }, { data: cooldown }] = authorized.context.appUserId ? await Promise.all([
    authorized.admin.schema("mediasis").from("platform_billing_owner_submissions").select("submission_id")
      .eq("owner_app_user_id", authorized.context.appUserId).gte("created_at", new Date(Date.now() - 3_600_000).toISOString()).limit(5),
    authorized.admin.schema("mediasis").from("platform_billing_owner_cooldowns").select("blocked_until")
      .eq("owner_app_user_id", authorized.context.appUserId).maybeSingle(),
  ]) : [{ data: [] }, { data: null }];
  const retryAt = cooldown?.blocked_until && new Date(cooldown.blocked_until).getTime() > Date.now() ? cooldown.blocked_until : null;
  const attemptsRemaining = retryAt ? 0 : Math.max(0, 5 - (submissions?.length ?? 0));
  const { data: pendingPurchase } = await authorized.admin.schema("mediasis").from("storefront_domain_purchase_attempts")
    .select("requested_domain,state,onvo_intent_id,local_reference,created_at")
    .eq("business_id", authorized.businessId)
    // `created` only means that checkout was opened. It is not a submitted
    // payment and must not trap an owner after they merely selected a card.
    .in("state", ["authorization_pending", "authorized", "registering", "registration_pending", "capture_failed"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return <main className="mx-auto grid w-full max-w-4xl gap-6 p-4 md:p-8"><div><h1 className="text-2xl font-semibold">Dominios</h1><p className="mt-1 text-sm text-muted-foreground">Comprá un dominio o conectá uno existente para la app de pedidos.</p></div>{linkCard}{!billing.success ? <Card><CardContent className="py-4 text-sm text-muted-foreground">Configurá la facturación antes de comprar un dominio.</CardContent></Card> : <DomainManager initialDomains={result.domains as never[]} canManage={result.canManage} billingEmail={billing.profile.billing_email} payerEmail={authorized.context.user.email} staffManagedUber={authorized.context.mode === "staff" && authorized.mediasisManaged} walletCards={(walletCards ?? []).map((card) => ({ id: card.owner_card_id, brand: card.card_brand, label: card.card_label, last4: card.card_last4 }))} selectedCardId={authorized.context.mode === "staff" ? null : selection?.owner_card_id ?? null} attemptsRemaining={attemptsRemaining} retryAt={retryAt} purchaseOutcome={purchaseOutcome} pendingPurchase={pendingPurchase ? { domain: pendingPurchase.requested_domain, state: pendingPurchase.state, orderNumber: pendingPurchase.local_reference, hasIntent: Boolean(pendingPurchase.onvo_intent_id) } : null} />}</main>;
}
