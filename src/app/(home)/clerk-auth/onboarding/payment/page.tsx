import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { synchronizeClerkIdentity } from "@/lib/dashboard/auth";
import { OnboardingPaymentCard } from "./OnboardingPaymentCard";
import { getMonthlyCancellationFeeTerms } from "@/app/admin/settings/billing/actions";

function displayUsd(minor: number) { return `$${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD`; }

export default async function OnboardingPaymentPage({ searchParams }: { searchParams: Promise<{ business?: string }> }) {
  const session = await auth();
  if (!session.userId) redirect("/clerk-auth/sign-in");
  const { business } = await searchParams;
  if (!business) redirect("/clerk-auth/onboarding");
  await synchronizeClerkIdentity(session.userId);
  const admin = createAdminClient();
  const { data: user } = await admin.schema("mediasis").from("app_users").select("app_user_id,primary_email").eq("clerk_user_id", session.userId).maybeSingle();
  if (!user?.app_user_id || !user.primary_email) redirect("/clerk-auth/onboarding");
  const [{ data: subscription }, { data: card }, { data: trial }, { data: owner }, { data: assignment }] = await Promise.all([
    admin.schema("mediasis").from("business_subscriptions")
    .select("business_id,amount_minor,billing_cadence,status,owner_app_user_id")
    .eq("business_id", business).eq("owner_app_user_id", user.app_user_id).maybeSingle(),
    admin.schema("mediasis").from("platform_billing_cards").select("platform_billing_card_id,card_brand,card_label,card_last4")
      .eq("business_id", business).eq("owner_app_user_id", user.app_user_id).eq("active", true).maybeSingle(),
    admin.schema("mediasis").from("business_trials").select("ends_at,status").eq("business_id", business).maybeSingle(),
    admin.schema("mediasis").from("business_account_owners").select("owner_app_user_id").eq("business_id", business).maybeSingle(),
    admin.schema("mediasis").from("business_plan_assignments").select("agreed_fixed_fee_minor,billing_cadence,subscription_plans!inner(stable_key)").eq("business_id", business).maybeSingle(),
  ]);
  const plan = Array.isArray(assignment?.subscription_plans) ? assignment.subscription_plans[0] : assignment?.subscription_plans;
  const legacyTrialEligible = owner?.owner_app_user_id === user.app_user_id
    && ["lite", "basic"].includes(plan?.stable_key ?? "") && trial?.status === "active" && Boolean(trial.ends_at)
    && new Date(trial.ends_at).getTime() > Date.now();
  if (!subscription && !legacyTrialEligible) redirect("/clerk-auth/onboarding");
  const { data: guided } = await admin.schema("mediasis").from("guided_storefront_onboarding")
    .select("review_completed_at").eq("business_id", business).eq("owner_app_user_id", user.app_user_id).maybeSingle();
  if (guided && !guided.review_completed_at) redirect(`/clerk-auth/onboarding/setup?business=${encodeURIComponent(business)}`);
  if (card && ((subscription && ["trialing", "active"].includes(subscription.status)) || legacyTrialEligible)) redirect("/admin");
  const firstCharge = new Date(trial?.status === "active" && trial.ends_at ? trial.ends_at : Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString("es-CR", { dateStyle: "long" });
  const cadence = (subscription?.billing_cadence ?? assignment?.billing_cadence) === "annual" ? "por año" : "por mes";
  const amountMinor = subscription?.amount_minor ?? assignment?.agreed_fixed_fee_minor;
  if (amountMinor == null) redirect("/clerk-auth/onboarding");
  const recovery = subscription?.status === "suspended" || subscription?.status === "past_due";
  const cancellationFeeTerms = recovery ? null : await getMonthlyCancellationFeeTerms(business);
  const { data: otherBusiness } = await admin.schema("mediasis").from("business_memberships")
    .select("business_id").eq("app_user_id", user.app_user_id).eq("status", "active")
    .neq("business_id", business).limit(1);
  return <main className="min-h-svh bg-[#f6f8fc] px-4 py-8 sm:py-12">
    {guided ? <div className="mx-auto mb-6 flex max-w-6xl items-center justify-between"><img src="/mediasis-logo.png" alt="Mediasis" className="h-9 w-auto" />
      {otherBusiness?.length ? <Link href="/admin" className="rounded-full border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Volver al dashboard</Link> : null}</div> : null}
    <OnboardingPaymentCard businessId={business} billingEmail={user.primary_email} storedCard={card ? { brand: card.card_brand, label: card.card_label, last4: card.card_last4 } : null} priceLabel={`${displayUsd(Number(amountMinor))} ${cadence}`} firstChargeLabel={firstCharge} recovery={recovery} cancellationFeeTerms={cancellationFeeTerms} guided={Boolean(guided)} />
  </main>;
}
