import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireBillingAccess } from "@/lib/dashboard/billing-authorization";
import { BillingEmailForm } from "./billing-email-form";
import { getBillingProfile, getDomainPurchaseReceipts, getSubscriptionBillingData } from "./actions";
import { DomainPurchaseReceipts } from "./domain-purchase-receipts";
import { SubscriptionBillingCard } from "./subscription-billing-card";
import { BillingCardSection } from "./billing-card-section";
import { PlanChangeCard } from "./plan-change-card";
import { StaffPlanOfferCard } from "./staff-plan-offer-card";

export default async function BillingPage() {
  const authorized = await requireBillingAccess();
  if (!authorized.success) return <DashboardAccessDenied title="Facturación no disponible" description={authorized.message} />;
  const profileResult = await getBillingProfile();
  if (!profileResult.success) return <DashboardAccessDenied title="Facturación no disponible" description={profileResult.message} />;
  const { data: assignment } = await authorized.admin.schema("mediasis").from("business_plan_assignments")
    .select("subscription_plan_id,billing_cadence,currency_code,agreed_fixed_fee_minor,agreed_sales_percentage_basis_points")
    .eq("business_id", authorized.businessId)
    .maybeSingle();
  const { data: subscriptionPlan } = assignment?.subscription_plan_id
    ? await authorized.admin.schema("mediasis").from("subscription_plans")
      .select("stable_key,display_name,active")
      .eq("subscription_plan_id", assignment.subscription_plan_id)
      .maybeSingle()
    : { data: null };
  const [receiptsResult, subscriptionResult, accountOwnerResult, pendingResult, offerResult, cardResult] = await Promise.all([
    getDomainPurchaseReceipts(), getSubscriptionBillingData(),
    authorized.admin.schema("mediasis").from("business_account_owners").select("owner_app_user_id")
      .eq("business_id", authorized.businessId).maybeSingle(),
    authorized.admin.schema("mediasis").from("business_subscription_plan_changes")
      .select("change_id,change_type,to_plan_id,to_cadence,effective_at,renewal_amount_minor,currency_code,consent_version")
      .eq("business_id", authorized.businessId).eq("status", "scheduled"),
    authorized.admin.schema("mediasis").from("business_staff_plan_offers")
      .select("offer_id,status,to_plan_id,to_cadence,amount_minor,currency_code,uber_sales_percentage_basis_points,effective_at,expires_at")
      .eq("business_id", authorized.businessId).in("status", ["offered", "accepted", "processing"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    authorized.admin.schema("mediasis").from("platform_billing_cards").select("platform_billing_card_id,card_brand,card_label,card_last4")
      .eq("business_id", authorized.businessId).eq("active", true).maybeSingle(),
  ]);
  const offerPlan = offerResult.data?.to_plan_id
    ? (await authorized.admin.schema("mediasis").from("subscription_plans").select("stable_key")
      .eq("subscription_plan_id", offerResult.data.to_plan_id).maybeSingle()).data : null;
  // The business account owner is always the billing owner. Subscription and
  // trial rows are billing records, never a separate authority boundary.
  const isOwner = authorized.canManage
    && accountOwnerResult.data?.owner_app_user_id === authorized.context.appUserId;
  const isUber = Boolean(subscriptionPlan?.stable_key?.startsWith("uber_"));
  const agreedPrice = assignment?.agreed_fixed_fee_minor == null ? null : new Intl.NumberFormat("es-CR", {
    style: "currency", currency: assignment.currency_code ?? "CRC",
  }).format(Number(assignment.agreed_fixed_fee_minor) / 100);
  return <main className="mx-auto grid w-full max-w-3xl gap-6 p-4 md:p-8"><div><h1 className="text-2xl font-semibold">Facturación</h1><p className="mt-1 text-sm text-muted-foreground">Administrá el método de pago que Mediasis usará para servicios futuros.</p></div>
    <Card><CardHeader><CardTitle>Plan actual</CardTitle><CardDescription>Este es el plan y precio acordados para el negocio.</CardDescription></CardHeader><CardContent><p className="text-lg font-medium">{subscriptionPlan?.active ? (subscriptionPlan.display_name ?? subscriptionPlan.stable_key) : "Sin plan asignado"}</p>{agreedPrice ? <p className="text-sm text-muted-foreground">{agreedPrice} por {isUber ? "semana" : assignment?.billing_cadence === "annual" ? "año" : "mes"}</p> : null}{isUber && assignment?.agreed_sales_percentage_basis_points ? <p className="text-sm text-muted-foreground">{Number(assignment.agreed_sales_percentage_basis_points) / 100}% de ventas</p> : null}</CardContent></Card>
    {authorized.canManage ? <Card><CardHeader><CardTitle>Identidad de facturación</CardTitle><CardDescription>Se inicializó con el correo del administrador activo más antiguo y se mantiene estable hasta que lo actualicés.</CardDescription></CardHeader><CardContent><BillingEmailForm initialEmail={profileResult.profile.billing_email} /></CardContent></Card> : null}
    <BillingCardSection canManage={isOwner} billingEmail={profileResult.profile.billing_email}
      storedCard={cardResult.data ? { brand: cardResult.data.card_brand, label: cardResult.data.card_label, last4: cardResult.data.card_last4 } : null} />
    {offerResult.data && offerPlan ? <StaffPlanOfferCard offer={{ id: offerResult.data.offer_id,
      status: offerResult.data.status, targetPlan: offerPlan.stable_key,
      cadence: offerResult.data.to_cadence, amountMinor: Number(offerResult.data.amount_minor),
      currency: offerResult.data.currency_code, effectiveAt: offerResult.data.effective_at,
      expiresAt: offerResult.data.expires_at, uberSalesPercentageBasisPoints: offerResult.data.uber_sales_percentage_basis_points }} isOwner={isOwner}
      fromUber={Boolean(subscriptionPlan?.stable_key?.startsWith("uber_"))}
      hasCard={Boolean(cardResult.data && subscriptionResult.success && subscriptionResult.subscription)} /> : null}
    {subscriptionResult.success && !isUber ? <SubscriptionBillingCard subscription={subscriptionResult.subscription} canManage={authorized.canManage} /> : null}
    {subscriptionResult.success && subscriptionResult.subscription && subscriptionPlan && !offerResult.data && ["lite", "basic"].includes(subscriptionPlan.stable_key)
      ? <PlanChangeCard currentPlan={subscriptionPlan.stable_key as "lite" | "basic"}
          subscription={subscriptionResult.subscription}
          isOwner={isOwner}
          pending={(pendingResult.data ?? []).filter((item) => !item.consent_version?.startsWith("staff-offer:")).map((item) => ({
            changeType: item.change_type as "plan" | "cadence", effectiveAt: item.effective_at,
            renewalAmountMinor: Number(item.renewal_amount_minor), currencyCode: item.currency_code,
          }))} /> : null}
    {receiptsResult.success ? <DomainPurchaseReceipts receipts={receiptsResult.receipts} /> : null}
  </main>;
}
