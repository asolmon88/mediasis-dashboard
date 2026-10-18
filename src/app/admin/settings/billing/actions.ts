"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { requireBillingAccess } from "@/lib/dashboard/billing-authorization";
import { synchronizeClerkIdentity } from "@/lib/dashboard/auth";
import { getOnvoPlatformConfig, verifyOnvoPlatformCard } from "@/lib/onvo/platform-billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { processClaimedSubscriptionCharge, type ClaimedSubscriptionCharge } from "@/lib/dashboard/subscription-charge-runner";
import { sendSubscriptionBillingEmail } from "@/lib/emails/subscription-billing";

const emailSchema = z.string().trim().email("Ingresá un correo electrónico válido.").max(320);
const cardAliasSchema = z.string().trim().min(1, "Ingresá un nombre para la tarjeta.").max(60, "El nombre puede tener hasta 60 caracteres.");

type BillingProfile = { billing_email: string; initialized_from_app_user_id: string | null };

type OnboardingBillingAccess = { admin: ReturnType<typeof createAdminClient>; businessId: string; appUserId: string; billingEmail: string };

async function monthlyFeeTerms(access: OnboardingBillingAccess) {
  const { data: sub, error: subError } = await access.admin.schema("mediasis").from("business_subscriptions")
    .select("billing_cadence,amount_minor,currency_code,created_at,status")
    .eq("business_id", access.businessId).eq("owner_app_user_id", access.appUserId).maybeSingle();
  if (subError) throw subError;
  if (!sub || sub.billing_cadence !== "monthly" || !["awaiting_card", "trialing"].includes(sub.status)) return null;
  const { data: market, error: marketError } = await access.admin.schema("mediasis").from("business_market_settings")
    .select("country_code").eq("business_id", access.businessId).maybeSingle();
  if (marketError || !market?.country_code) throw new Error("No se pudo verificar el mercado del negocio.");
  const { data: policy, error: policyError } = await access.admin.schema("mediasis").from("monthly_cancellation_fee_policies")
    .select("terms_version,effective_at").eq("country_code", market.country_code).eq("enabled", true).maybeSingle();
  if (policyError) throw policyError;
  if (!policy?.effective_at || new Date(sub.created_at).getTime() < new Date(policy.effective_at).getTime()) return null;
  return { termsVersion: policy.terms_version, amountMinor: Number(sub.amount_minor), currencyCode: sub.currency_code };
}

export async function getMonthlyCancellationFeeTerms(businessId: string) {
  const access = await requireOnboardingBillingOwner(businessId);
  return monthlyFeeTerms(access);
}

async function recordMonthlyFeeConsent(access: OnboardingBillingAccess, accepted: boolean) {
  const terms = await monthlyFeeTerms(access);
  if (!terms) return;
  if (!accepted) throw new Error("Aceptá el cargo final del plan mensual para continuar.");
  const { data, error } = await access.admin.schema("mediasis").rpc("record_monthly_cancellation_fee_consent", {
    p_owner_app_user_id: access.appUserId, p_business_id: access.businessId,
    p_terms_version: terms.termsVersion,
  });
  if (error || !data?.success) throw new Error(error?.message ?? "No se pudo registrar el consentimiento del cargo final.");
}

async function requireOnboardingBillingOwner(businessId: string): Promise<OnboardingBillingAccess> {
  const session = await auth();
  if (!session.userId) throw new Error("Iniciá sesión para agregar tu tarjeta.");
  await synchronizeClerkIdentity(session.userId);
  const admin = createAdminClient();
  const { data: user } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id,primary_email,status,deleted_at,dashboard_disabled_at").eq("clerk_user_id", session.userId).maybeSingle();
  if (!user?.app_user_id || !user.primary_email || user.status !== "active" || user.deleted_at || user.dashboard_disabled_at) {
    throw new Error("No se pudo verificar la cuenta propietaria.");
  }
  const { data: owner } = await admin.schema("mediasis").from("business_account_owners")
    .select("owner_app_user_id").eq("business_id", businessId).maybeSingle();
  if (owner?.owner_app_user_id !== user.app_user_id) throw new Error("Solo el propietario de la cuenta puede agregar la tarjeta.");
  const { data: membership } = await admin.schema("mediasis").from("business_memberships")
    .select("business_membership_id").eq("business_id", businessId).eq("app_user_id", user.app_user_id)
    .eq("status", "active").is("revoked_at", null).maybeSingle();
  if (!membership) throw new Error("La cuenta propietaria no tiene acceso activo al negocio.");
  const { data: guided, error: guidedError } = await admin.schema("mediasis")
    .from("guided_storefront_onboarding").select("review_completed_at")
    .eq("business_id", businessId).maybeSingle();
  if (guidedError) throw new Error("No se pudo verificar el estado de configuración.");
  if (guided && !guided.review_completed_at) throw new Error("Terminá la vista previa antes de agregar una tarjeta.");
  return { admin, businessId, appUserId: user.app_user_id, billingEmail: user.primary_email.trim().toLowerCase() };
}

async function ensureOnboardingBillingProfile(access: OnboardingBillingAccess) {
  const { data: existing, error } = await access.admin.schema("mediasis").from("business_billing_profiles")
    .select("billing_email").eq("business_id", access.businessId).maybeSingle();
  if (error) throw new Error("No se pudo cargar el perfil de facturación.");
  if (existing?.billing_email) return existing.billing_email;
  const { error: upsertError } = await access.admin.schema("mediasis").from("business_billing_profiles").upsert({
    business_id: access.businessId, billing_email: access.billingEmail,
    initialized_from_app_user_id: access.appUserId, updated_at: new Date().toISOString(),
  }, { onConflict: "business_id" });
  if (upsertError) throw new Error("No se pudo crear el perfil de facturación.");
  return access.billingEmail;
}
export type DomainPurchaseReceipt = {
  billing_receipt_id: string;
  receipt_number: string;
  purchased_domain: string;
  amount_minor: number;
  currency_code: string;
  paid_at: string;
  receipt_email: string;
  email_delivery_status: "pending" | "sent" | "failed";
};

export type SubscriptionBillingData = {
  status: string;
  amountMinor: number;
  currencyCode: string;
  billingCadence: "monthly" | "annual";
  nextChargeAt: string | null;
  graceEndsAt: string | null;
  cancelAt: string | null;
  currentPeriodEndsAt: string | null;
  cancellationFeeApplies: boolean;
  card: { brand: string | null; label: string | null } | null;
  receipts: Array<{ receipt_number: string; amount_minor: number; currency_code: string; paid_at: string }>;
};

async function ensureBillingProfile(authorized: Extract<Awaited<ReturnType<typeof requireBillingAccess>>, { success: true }>) {
  const { data: existing, error: existingError } = await authorized.admin.schema("mediasis")
    .from("business_billing_profiles")
    .select("billing_email,initialized_from_app_user_id")
    .eq("business_id", authorized.businessId)
    .maybeSingle<BillingProfile>();
  if (existingError) throw new Error("No se pudo cargar el perfil de facturación.");
  if (existing) return existing;

  const { data: firstMember, error: memberError } = await authorized.admin.schema("mediasis")
    .from("business_memberships")
    .select("app_user_id,app_users!inner(primary_email),business_membership_roles!inner(revoked_at,business_roles!inner(role_key))")
    .eq("business_id", authorized.businessId)
    .eq("status", "active")
    .is("revoked_at", null)
    .is("business_membership_roles.revoked_at", null)
    .eq("business_membership_roles.business_roles.role_key", "business_full_access")
    .not("app_users.primary_email", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (memberError) throw new Error("No se pudo resolver el administrador de facturación.");

  const firstMemberData = firstMember as { app_user_id: string; app_users: { primary_email: string | null } | Array<{ primary_email: string | null }> } | null;
  const nestedUser = Array.isArray(firstMemberData?.app_users) ? firstMemberData?.app_users[0] : firstMemberData?.app_users;
  const billingEmail = nestedUser?.primary_email?.trim().toLowerCase() ?? authorized.context.user.email.trim().toLowerCase();
  if (!billingEmail) throw new Error("Agregá un correo electrónico a un administrador antes de configurar la facturación.");

  const profile = { business_id: authorized.businessId, billing_email: billingEmail, initialized_from_app_user_id: firstMemberData?.app_user_id ?? null };
  const { data: created, error: createError } = await authorized.admin.schema("mediasis")
    .from("business_billing_profiles")
    .upsert(profile, { onConflict: "business_id", ignoreDuplicates: true })
    .select("billing_email,initialized_from_app_user_id")
    .maybeSingle<BillingProfile>();
  if (createError) throw new Error("No se pudo crear el perfil de facturación.");
  return created ?? { billing_email: billingEmail, initialized_from_app_user_id: firstMemberData?.app_user_id ?? null };
}

export async function getBillingProfile() {
  const authorized = await requireBillingAccess();
  if (!authorized.success) return { success: false as const, message: authorized.message };
  try {
    const profile = await ensureBillingProfile(authorized);
    return { success: true as const, profile };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "No se pudo cargar la facturación." };
  }
}

export async function updateBillingEmail(rawEmail: string) {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return { success: false as const, message: parsed.error.issues[0]?.message ?? "Correo inválido." };
  const authorized = await requireBillingAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  const { error } = await authorized.admin.schema("mediasis").from("business_billing_profiles").upsert({
    business_id: authorized.businessId,
    billing_email: parsed.data.toLowerCase(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "business_id" });
  if (error) return { success: false as const, message: "No se pudo actualizar el correo de facturación." };
  revalidatePath("/admin/settings/billing");
  return { success: true as const, message: "Correo de facturación actualizado." };
}

export async function updateOnvoSubscriptionCardAlias(rawAlias: string, onboardingBusinessId?: string) {
  const parsed = cardAliasSchema.safeParse(rawAlias);
  if (!parsed.success) return { success: false as const, message: parsed.error.issues[0]?.message ?? "Nombre inválido." };
  if (onboardingBusinessId) {
    try {
      const access = await requireOnboardingBillingOwner(onboardingBusinessId);
      const { data: card, error } = await access.admin.schema("mediasis").from("platform_billing_cards")
        .update({ card_label: parsed.data }).eq("business_id", access.businessId).eq("owner_app_user_id", access.appUserId)
        .eq("active", true).select("platform_billing_card_id").maybeSingle();
      if (error || !card) throw new Error("No se pudo actualizar el nombre de la tarjeta.");
      const { data: selected } = await access.admin.schema("mediasis").from("platform_billing_business_card_selections")
        .select("owner_card_id").eq("business_id", access.businessId).maybeSingle();
      if (selected) await access.admin.schema("mediasis").from("platform_billing_owner_cards")
        .update({ card_label: parsed.data }).eq("owner_card_id", selected.owner_card_id).eq("owner_app_user_id", access.appUserId);
      revalidatePath("/clerk-auth/onboarding/payment");
      return { success: true as const, message: "Nombre de tarjeta actualizado." };
    } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo actualizar el nombre." }; }
  }
  const authorized = await requireBillingAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  if (!authorized.context.appUserId) return { success: false as const, message: "No se pudo identificar la cuenta propietaria." };
  const { data: owner, error: ownerError } = await authorized.admin.schema("mediasis").from("business_account_owners")
    .select("owner_app_user_id").eq("business_id", authorized.businessId).maybeSingle();
  if (ownerError || owner?.owner_app_user_id !== authorized.context.appUserId) {
    return { success: false as const, message: "Solo el propietario de la cuenta del negocio puede cambiar el nombre de la tarjeta." };
  }
  const { data: card, error } = await authorized.admin.schema("mediasis").from("platform_billing_cards")
    .update({ card_label: parsed.data })
    .eq("business_id", authorized.businessId).eq("active", true)
    .select("platform_billing_card_id").maybeSingle();
  if (error || !card) return { success: false as const, message: "No se pudo actualizar el nombre de la tarjeta." };
  const { data: selected } = await authorized.admin.schema("mediasis").from("platform_billing_business_card_selections")
    .select("owner_card_id").eq("business_id", authorized.businessId).maybeSingle();
  if (selected) await authorized.admin.schema("mediasis").from("platform_billing_owner_cards")
    .update({ card_label: parsed.data }).eq("owner_card_id", selected.owner_card_id).eq("owner_app_user_id", authorized.context.appUserId);
  revalidatePath("/admin/settings/billing");
  return { success: true as const, message: "Nombre de tarjeta actualizado." };
}

export type OwnerWalletCard = { owner_card_id: string; card_brand: string | null; card_last4: string | null; card_label: string | null; selected: boolean };

export async function getOnvoOwnerWallet(onboardingBusinessId?: string) {
  try {
    const access = onboardingBusinessId ? await requireOnboardingBillingOwner(onboardingBusinessId) : null;
    const authorized = access ? null : await requireBillingAccess(true);
    if (authorized && !authorized.success) return { success: false as const, message: authorized.message };
    const admin = access?.admin ?? (authorized && authorized.success ? authorized.admin : createAdminClient());
    const businessId = access?.businessId ?? (authorized && authorized.success ? authorized.businessId : "");
    const ownerId = access?.appUserId ?? (authorized && authorized.success ? authorized.context.appUserId : null);
    if (!ownerId) throw new Error("No se pudo identificar al propietario.");
    const { data: market, error: marketError } = await admin.schema("mediasis").from("business_market_settings")
      .select("country_code").eq("business_id", businessId).maybeSingle();
    if (marketError || !market?.country_code) throw new Error("No se pudo determinar el mercado de facturación.");
    const [{ data: cards, error }, { data: selected }, { data: submissions }, { data: cooldown }] = await Promise.all([
      admin.schema("mediasis").from("platform_billing_owner_cards")
        .select("owner_card_id,card_brand,card_last4,card_label")
        .eq("owner_app_user_id", ownerId).eq("country_code", market.country_code)
        .is("removed_at", null).order("created_at", { ascending: true }),
      admin.schema("mediasis").from("platform_billing_business_card_selections")
        .select("owner_card_id").eq("business_id", businessId).maybeSingle(),
      admin.schema("mediasis").from("platform_billing_owner_submissions").select("submission_id")
        .eq("owner_app_user_id", ownerId).gte("created_at", new Date(Date.now() - 3_600_000).toISOString()).limit(5),
      admin.schema("mediasis").from("platform_billing_owner_cooldowns").select("blocked_until")
        .eq("owner_app_user_id", ownerId).maybeSingle(),
    ]);
    if (error) throw error;
    const retryAt = cooldown?.blocked_until && new Date(cooldown.blocked_until).getTime() > Date.now() ? cooldown.blocked_until : null;
    return { success: true as const, cards: (cards ?? []).map((card) => ({ ...card, selected: selected?.owner_card_id === card.owner_card_id })) as OwnerWalletCard[],
      attemptsRemaining: retryAt ? 0 : Math.max(0, 5 - (submissions?.length ?? 0)), retryAt };
  } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudieron cargar las tarjetas." }; }
}

export async function selectOnvoOwnerWalletCard(ownerCardId: string, onboardingBusinessId?: string, cancellationFeeConsent = false) {
  try {
    const access = onboardingBusinessId ? await requireOnboardingBillingOwner(onboardingBusinessId) : null;
    const authorized = access ? null : await requireBillingAccess(true);
    if (authorized && !authorized.success) return { success: false as const, message: authorized.message };
    const admin = access?.admin ?? (authorized && authorized.success ? authorized.admin : createAdminClient());
    const businessId = access?.businessId ?? (authorized && authorized.success ? authorized.businessId : "");
    const ownerId = access?.appUserId ?? (authorized && authorized.success ? authorized.context.appUserId : null);
    if (!ownerId) throw new Error("Solo el propietario puede elegir la tarjeta.");
    const { data: walletCard, error: walletError } = await admin.schema("mediasis").from("platform_billing_owner_cards")
      .select("provider_customer_id,provider_payment_method_id").eq("owner_card_id", ownerCardId)
      .eq("owner_app_user_id", ownerId).is("removed_at", null).maybeSingle();
    if (walletError || !walletCard) throw new Error("No se encontró esta tarjeta en tu cuenta.");
    const config = await getOnvoPlatformConfig(admin, businessId);
    await verifyOnvoPlatformCard({ secretKey: config.secretKey,
      paymentMethodId: walletCard.provider_payment_method_id, customerId: walletCard.provider_customer_id });
    const { data, error } = await admin.schema("mediasis").rpc("select_onvo_owner_wallet_card", {
      p_business_id: businessId, p_owner_app_user_id: ownerId, p_owner_card_id: ownerCardId,
    });
    if (error || !data?.success) throw new Error(error?.message ?? "No se pudo elegir la tarjeta.");
    if (access) {
      const { data: materialized, error: materializeError } = await admin.schema("mediasis").rpc("materialize_legacy_self_service_trial", {
        p_business_id: businessId, p_owner_app_user_id: ownerId,
      });
      if (materializeError || !materialized?.success) throw new Error(materializeError?.message ?? "No se pudo preparar la suscripción.");
      await recordMonthlyFeeConsent(access, cancellationFeeConsent);
      const { data: activated, error: activationError } = await admin.schema("mediasis").rpc("activate_onvo_business_subscription_trial", {
        p_owner_app_user_id: ownerId, p_business_id: businessId, p_consent_version: "onvo-recurring-v1",
      });
      if (activationError || !activated?.success) throw new Error(activationError?.message ?? "No se pudo actualizar la suscripción.");
    }
    await admin.schema("mediasis").rpc("resume_business_after_onvo_card", { p_business_id: businessId, p_owner_id: ownerId });
    revalidatePath("/admin/settings/billing");
    revalidatePath("/clerk-auth/onboarding/payment");
    return { success: true as const, message: "Tarjeta seleccionada para este negocio." };
  } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo elegir la tarjeta." }; }
}

export async function removeOnvoOwnerWalletCard(ownerCardId: string, onboardingBusinessId?: string) {
  try {
    const access = onboardingBusinessId ? await requireOnboardingBillingOwner(onboardingBusinessId) : null;
    const authorized = access ? null : await requireBillingAccess(true);
    if (authorized && !authorized.success) return { success: false as const, message: authorized.message };
    const admin = access?.admin ?? (authorized && authorized.success ? authorized.admin : createAdminClient());
    const ownerId = access?.appUserId ?? (authorized && authorized.success ? authorized.context.appUserId : null);
    if (!ownerId) throw new Error("Solo el propietario puede quitar una tarjeta.");
    const { data, error } = await admin.schema("mediasis").rpc("remove_onvo_owner_wallet_card", {
      p_owner_app_user_id: ownerId, p_owner_card_id: ownerCardId,
    });
    if (error || !data?.success) throw new Error(error?.message ?? "No se pudo quitar la tarjeta.");
    revalidatePath("/admin/settings/billing");
    return { success: true as const, message: "Tarjeta quitada." };
  } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo quitar la tarjeta." }; }
}

/** Returns only a publishable key. PAN and CVV are posted browser-to-Onvo. */
export async function getOnvoBillingCardSetup(onboardingBusinessId?: string, submissionKey?: string) {
  if (onboardingBusinessId) {
    try {
      const access = await requireOnboardingBillingOwner(onboardingBusinessId);
      if (submissionKey) {
        const { count: cardCount, error: cardCountError } = await access.admin.schema("mediasis").from("platform_billing_owner_cards")
          .select("owner_card_id", { count: "exact", head: true }).eq("owner_app_user_id", access.appUserId).is("removed_at", null);
        if (cardCountError) throw new Error(cardCountError.message);
        if ((cardCount ?? 0) >= 3) throw new Error("Ya guardaste tres tarjetas. Quitá una que no esté asignada a ningún negocio antes de agregar otra.");
        const { data: limit, error: limitError } = await access.admin.schema("mediasis").rpc("reserve_onvo_owner_submission", {
          p_owner_app_user_id: access.appUserId, p_business_id: access.businessId, p_kind: "card_add", p_submission_key: submissionKey,
        });
        if (limitError) throw new Error(limitError.message);
        if (!limit?.success) throw new Error(`Llegaste al límite de cinco intentos. Podés volver a intentar después de ${new Date(limit.retry_at).toLocaleString("es-CR")}.`);
      }
      const config = await getOnvoPlatformConfig(access.admin, access.businessId);
      const { data: market } = await access.admin.schema("mediasis").from("business_market_settings")
        .select("country_code").eq("business_id", access.businessId).maybeSingle();
      return { success: true as const, publishableKey: config.publishableKey, countryCode: market?.country_code ?? "CR" };
    } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo preparar Onvo." }; }
  }
  const authorized = await requireBillingAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  try {
    if (submissionKey && authorized.context.appUserId) {
      const { count: cardCount, error: cardCountError } = await authorized.admin.schema("mediasis").from("platform_billing_owner_cards")
        .select("owner_card_id", { count: "exact", head: true }).eq("owner_app_user_id", authorized.context.appUserId).is("removed_at", null);
      if (cardCountError) throw new Error(cardCountError.message);
      if ((cardCount ?? 0) >= 3) throw new Error("Ya guardaste tres tarjetas. Quitá una que no esté asignada a ningún negocio antes de agregar otra.");
      const { data: limit, error: limitError } = await authorized.admin.schema("mediasis").rpc("reserve_onvo_owner_submission", {
        p_owner_app_user_id: authorized.context.appUserId, p_business_id: authorized.businessId, p_kind: "card_add", p_submission_key: submissionKey,
      });
      if (limitError) throw new Error(limitError.message);
      if (!limit?.success) throw new Error(`Llegaste al límite de cinco intentos. Podés volver a intentar después de ${new Date(limit.retry_at).toLocaleString("es-CR")}.`);
    }
    const config = await getOnvoPlatformConfig(authorized.admin, authorized.businessId);
    const { data: market } = await authorized.admin.schema("mediasis").from("business_market_settings")
      .select("country_code").eq("business_id", authorized.businessId).maybeSingle();
    return { success: true as const, publishableKey: config.publishableKey, countryCode: market?.country_code ?? "CR" };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "No se pudo preparar Onvo." };
  }
}

export async function saveOnvoBillingCard(input: { paymentMethodId: string; customerId: string; label: string; recurringConsent: boolean; submissionKey: string; onboardingBusinessId?: string; cancellationFeeConsent?: boolean }) {
  if (input.onboardingBusinessId) {
    if (!input.recurringConsent) return { success: false as const, message: "Aceptá los términos de cobro recurrente para continuar." };
    try {
      const access = await requireOnboardingBillingOwner(input.onboardingBusinessId);
      const { error: consumeError } = await access.admin.schema("mediasis").rpc("consume_onvo_owner_card_submission", {
        p_owner_app_user_id: access.appUserId, p_business_id: access.businessId, p_submission_key: input.submissionKey,
      });
      if (consumeError) throw new Error(consumeError.message);
      const { data: materialized, error: materializeError } = await access.admin.schema("mediasis").rpc("materialize_legacy_self_service_trial", {
        p_business_id: access.businessId, p_owner_app_user_id: access.appUserId,
      });
      if (materializeError || !materialized?.success) throw new Error(materializeError?.message ?? "No se pudo preparar la suscripción.");
      const billingEmail = await ensureOnboardingBillingProfile(access);
      const config = await getOnvoPlatformConfig(access.admin, access.businessId);
      const verified = await verifyOnvoPlatformCard({ secretKey: config.secretKey, paymentMethodId: input.paymentMethodId, customerId: input.customerId });
      const { error: customerError } = await access.admin.schema("mediasis").from("platform_billing_customers").upsert({
        business_id: access.businessId, owner_app_user_id: access.appUserId, provider: "onvo", provider_customer_id: verified.customerId, state: "ready", updated_at: new Date().toISOString(),
      }, { onConflict: "business_id" });
      if (customerError) throw new Error("No se pudo vincular el cliente de Onvo.");
      const { data, error } = await access.admin.schema("mediasis").rpc("replace_platform_billing_card", {
        p_business_id: access.businessId, p_owner_app_user_id: access.appUserId,
        p_customer_id: verified.customerId, p_payment_method_id: input.paymentMethodId,
        p_email: billingEmail, p_brand: verified.brand ?? "", p_last4: verified.last4,
        p_label: input.label.trim(), p_recurring_consent: true,
      });
      if (error || !data?.success) throw new Error(error?.message ?? "No se pudo guardar la tarjeta.");
      await recordMonthlyFeeConsent(access, input.cancellationFeeConsent === true);
      const { data: activated, error: activationError } = await access.admin.schema("mediasis").rpc("activate_onvo_business_subscription_trial", {
        p_owner_app_user_id: access.appUserId, p_business_id: access.businessId, p_consent_version: "onvo-recurring-v1",
      });
      if (activationError || !activated?.success) throw new Error(activationError?.message ?? "No se pudo activar la prueba gratuita.");
      await access.admin.schema("mediasis").rpc("resume_business_after_onvo_card", { p_business_id: access.businessId, p_owner_id: access.appUserId });
      return { success: true as const, message: "Tarjeta de Onvo guardada." };
    } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo guardar la tarjeta." }; }
  }
  const authorized = await requireBillingAccess(true);
  if (!authorized.success || !authorized.context.appUserId) return { success: false as const, message: authorized.success ? "No se pudo identificar la cuenta propietaria." : authorized.message };
  if (!input.recurringConsent) return { success: false as const, message: "Aceptá los términos de cobro recurrente para continuar." };
  const { data: owner } = await authorized.admin.schema("mediasis").from("business_account_owners")
    .select("owner_app_user_id").eq("business_id", authorized.businessId).maybeSingle();
  if (owner?.owner_app_user_id !== authorized.context.appUserId) return { success: false as const, message: "Solo el propietario de la cuenta puede administrar la tarjeta." };
  try {
    const { error: consumeError } = await authorized.admin.schema("mediasis").rpc("consume_onvo_owner_card_submission", {
      p_owner_app_user_id: authorized.context.appUserId, p_business_id: authorized.businessId, p_submission_key: input.submissionKey,
    });
    if (consumeError) throw new Error(consumeError.message);
    const { data: legacySubscription, error: legacySubscriptionError } = await authorized.admin.schema("mediasis").rpc("materialize_legacy_self_service_trial", {
      p_business_id: authorized.businessId,
      p_owner_app_user_id: authorized.context.appUserId,
    });
    if (legacySubscriptionError || !legacySubscription?.success) {
      throw new Error(legacySubscriptionError?.message ?? "No se pudo preparar la suscripción.");
    }
    const profile = await ensureBillingProfile(authorized);
    const config = await getOnvoPlatformConfig(authorized.admin, authorized.businessId);
    const verified = await verifyOnvoPlatformCard({ secretKey: config.secretKey, paymentMethodId: input.paymentMethodId, customerId: input.customerId });
    const { data: customer, error: customerError } = await authorized.admin.schema("mediasis").from("platform_billing_customers")
      .upsert({ business_id: authorized.businessId, owner_app_user_id: authorized.context.appUserId, provider: "onvo", provider_customer_id: verified.customerId, state: "ready", updated_at: new Date().toISOString() }, { onConflict: "business_id" })
      .select("provider_customer_id").single();
    if (customerError || customer?.provider_customer_id !== verified.customerId) throw new Error("No se pudo vincular el cliente de Onvo.");
    const { data, error } = await authorized.admin.schema("mediasis").rpc("replace_platform_billing_card", {
      p_business_id: authorized.businessId, p_owner_app_user_id: authorized.context.appUserId,
      p_customer_id: verified.customerId, p_payment_method_id: input.paymentMethodId,
      p_email: profile.billing_email, p_brand: verified.brand ?? "", p_last4: verified.last4,
      p_label: input.label.trim(), p_recurring_consent: true,
    });
    if (error || !data?.success) throw new Error(error?.message ?? "No se pudo guardar la tarjeta.");
    const { data: activated, error: activationError } = await authorized.admin.schema("mediasis").rpc("activate_onvo_business_subscription_trial", {
      p_owner_app_user_id: authorized.context.appUserId, p_business_id: authorized.businessId, p_consent_version: "onvo-recurring-v1",
    });
    if (activationError || !activated?.success) throw new Error(activationError?.message ?? "No se pudo activar la prueba gratuita.");
    await authorized.admin.schema("mediasis").rpc("resume_business_after_onvo_card", { p_business_id: authorized.businessId, p_owner_id: authorized.context.appUserId });
    revalidatePath("/admin/settings/billing");
    return { success: true as const, message: "Tarjeta de Onvo guardada." };
  } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo guardar la tarjeta." }; }
}

export async function getDomainPurchaseReceipts() {
  const authorized = await requireBillingAccess();
  if (!authorized.success) return { success: false as const, message: authorized.message };
  const { data, error } = await authorized.admin.schema("mediasis").from("business_billing_receipts")
    .select("billing_receipt_id,receipt_number,purchased_domain,amount_minor,currency_code,paid_at,receipt_email,email_delivery_status")
    .eq("business_id", authorized.businessId)
    .order("paid_at", { ascending: false });
  if (error) return { success: false as const, message: "No se pudieron cargar los comprobantes." };
  return { success: true as const, receipts: (data ?? []) as DomainPurchaseReceipt[] };
}

export async function getSubscriptionBillingData() {
  const authorized = await requireBillingAccess();
  if (!authorized.success) return { success: false as const, message: authorized.message };
  const [{ data: subscription, error: subscriptionError }, { data: cards, error: cardError }, { data: receipts, error: receiptError }] = await Promise.all([
    authorized.admin.schema("mediasis").from("business_subscriptions")
      .select("status,amount_minor,currency_code,billing_cadence,next_charge_at,grace_ends_at,cancel_at,current_period_ends_at,cancellation_fee_consent_at,cancellation_fee_consent_version,created_at")
      .eq("business_id", authorized.businessId).maybeSingle(),
    authorized.admin.schema("mediasis").from("platform_billing_cards")
      .select("card_brand,card_label,card_last4").eq("business_id", authorized.businessId).eq("active", true).maybeSingle(),
    authorized.admin.schema("mediasis").from("business_subscription_receipts")
      .select("receipt_number,amount_minor,currency_code,paid_at").eq("business_id", authorized.businessId).order("paid_at", { ascending: false }),
  ]);
  if (subscriptionError || cardError || receiptError) return { success: false as const, message: "No se pudo cargar tu suscripción." };
  if (!subscription) return { success: true as const, subscription: null };
  const { data: market } = await authorized.admin.schema("mediasis").from("business_market_settings")
    .select("country_code").eq("business_id", authorized.businessId).maybeSingle();
  const { data: feePolicy } = market?.country_code ? await authorized.admin.schema("mediasis")
    .from("monthly_cancellation_fee_policies").select("enabled,effective_at,terms_version")
    .eq("country_code", market.country_code).maybeSingle() : { data: null };
  const cancellationFeeApplies = subscription.billing_cadence === "monthly"
    && Boolean(subscription.cancellation_fee_consent_at && feePolicy?.enabled && feePolicy.effective_at
      && subscription.cancellation_fee_consent_version === feePolicy.terms_version
      && new Date(subscription.created_at).getTime() >= new Date(feePolicy.effective_at).getTime());
  return { success: true as const, subscription: {
    status: subscription.status, amountMinor: Number(subscription.amount_minor), currencyCode: subscription.currency_code,
    billingCadence: subscription.billing_cadence as "monthly" | "annual", nextChargeAt: subscription.next_charge_at,
    graceEndsAt: subscription.grace_ends_at, cancelAt: subscription.cancel_at,
    currentPeriodEndsAt: subscription.current_period_ends_at, cancellationFeeApplies,
    card: cards ? { brand: cards.card_brand, label: cards.card_label } : null,
    receipts: (receipts ?? []).map((receipt) => ({ ...receipt, amount_minor: Number(receipt.amount_minor) })),
  } satisfies SubscriptionBillingData };
}

export async function acceptStaffPlanOffer(offerId: string, acceptedTerms: boolean) {
  if (!acceptedTerms) return { success: false, message: "Aceptá los nuevos términos de cobro recurrente." };
  const access = await requireBillingAccess(true);
  if (!access.success || !access.context.appUserId) return { success: false, message: "No tenés acceso a esta propuesta." };
  const { data, error } = await access.admin.schema("mediasis").rpc("accept_staff_plan_offer", {
    p_owner_id: access.context.appUserId, p_offer_id: offerId, p_consent_version: "staff-plan-v1",
  });
  if (error || !data?.success) return { success: false, message: error?.message ?? "No se pudo aceptar la propuesta." };
  if (data.mode === "handoff") {
    const { data: claims, error: claimError } = await access.admin.schema("mediasis").rpc("claim_onvo_pending_subscription_upgrades", {
      p_limit: 1, p_business_id: access.businessId,
    });
    if (claimError || !claims?.length) return { success: true, message: "El pago está pendiente de verificación." };
    try {
      const outcome = await processClaimedSubscriptionCharge(claims[0] as ClaimedSubscriptionCharge);
      revalidatePath("/admin/settings/billing");
      return { success: true, message: outcome === "paid" ? "Pago confirmado: tu plan ya está activo."
        : outcome === "failed" ? "El pago fue rechazado; tu plan Uber continúa activo."
        : "Estamos verificando el pago; tu plan Uber continúa activo." };
    } catch { return { success: true, message: "Estamos verificando el pago; tu plan Uber continúa activo." }; }
  }
  revalidatePath("/admin/settings/billing");
  return { success: true, message: data.mode === "trial" ? "El precio de tu primera factura ya está actualizado; la prueba termina en la fecha original."
    : "Cambio programado para tu próxima renovación." };
}

export async function setSubscriptionCancellation(cancel: boolean, acceptedFinalFee = false) {
  const authorized = await requireBillingAccess(true);
  if (!authorized.success) return { success: false, message: authorized.message };
  if (cancel) {
    const current = await getSubscriptionBillingData();
    if (!current.success || !current.subscription) return { success: false, message: "No se pudo verificar tu suscripción." };
    if (current.subscription.cancellationFeeApplies && !acceptedFinalFee) {
      return { success: false, message: "Aceptá el cargo final indicado antes de cancelar." };
    }
  }
  const { data, error } = await authorized.admin.schema("mediasis").rpc("cancel_business_subscription", {
    p_owner_app_user_id: authorized.context.appUserId,
    p_business_id: authorized.businessId,
    p_cancel: cancel,
  });
  if (error || !data?.success) return { success: false, message: error?.message ?? "No se pudo actualizar la suscripción." };
  revalidatePath("/admin/settings/billing");
  return { success: true, message: cancel ? "La suscripción se cancelará al terminar el periodo actual." : "La renovación automática fue reactivada." };
}

export type PlanChangeQuote = {
  success: boolean;
  message?: string;
  mode?: "trial" | "upgrade" | "scheduled";
  current_plan?: "lite" | "basic";
  target_plan?: "lite" | "basic";
  current_cadence?: "monthly" | "annual";
  target_cadence?: "monthly" | "annual";
  charge_minor?: number;
  renewal_amount_minor?: number;
  currency_code?: string;
  effective_at?: string;
  period_ends_at?: string | null;
  subscription_updated_at?: string;
};

export async function getPlanChangeQuote(changeType: "plan" | "cadence", target: string) {
  const access = await requireBillingAccess(true);
  if (!access.success || !access.context.appUserId) return { success: false, message: "No tenés acceso a este cambio." } as PlanChangeQuote;
  const { data, error } = await access.admin.schema("mediasis").rpc("quote_business_subscription_change", {
    p_owner_app_user_id: access.context.appUserId,
    p_business_id: access.businessId,
    p_change_type: changeType,
    p_target: target,
  });
  if (error) return { success: false, message: "No se pudo calcular el cambio de plan." } as PlanChangeQuote;
  return data as PlanChangeQuote;
}

export async function confirmPlanChange(input: {
  changeType: "plan" | "cadence"; target: string;
  expectedChargeMinor: number; expectedRenewalMinor: number;
  expectedUpdatedAt: string; acceptedTerms: boolean;
}) {
  if (!input.acceptedTerms) return { success: false, message: "Aceptá los nuevos términos de cobro." };
  const access = await requireBillingAccess(true);
  if (!access.success || !access.context.appUserId) return { success: false, message: "No tenés acceso a este cambio." };
  const { data, error } = await access.admin.schema("mediasis").rpc("request_onvo_business_subscription_change", {
    p_owner_app_user_id: access.context.appUserId,
    p_business_id: access.businessId,
    p_change_type: input.changeType,
    p_target: input.target,
    p_expected_charge_minor: input.expectedChargeMinor,
    p_expected_renewal_minor: input.expectedRenewalMinor,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_consent_version: "plan-change-v1",
  });
  if (error || !data?.success) return { success: false, message: data?.message ?? error?.message ?? "No se pudo solicitar el cambio." };
  if (data.mode === "upgrade") {
    const { data: claimed, error: claimError } = await access.admin.schema("mediasis")
      .rpc("claim_onvo_pending_subscription_upgrades", { p_limit: 1, p_business_id: access.businessId });
    if (claimError || !claimed?.length) return { success: true, message: "Tu solicitud quedó registrada. Estamos verificando el pago." };
    try {
      const result = await processClaimedSubscriptionCharge(claimed[0] as ClaimedSubscriptionCharge);
      revalidatePath("/admin/settings/billing");
      return { success: true, message: result === "paid" ? "Pago confirmado: tu nuevo plan ya está activo."
        : result === "failed" ? "No se confirmó el pago. Tu plan anterior sigue activo."
        : "Estamos verificando el pago. Tu plan anterior sigue activo por ahora." };
    } catch {
      return { success: true, message: "Tu pago está en verificación. Tu plan anterior sigue activo por ahora." };
    }
  }
  const { data: card } = await access.admin.schema("mediasis").from("platform_billing_cards")
    .select("cardholder_email").eq("business_id", access.businessId).eq("provider", "onvo").eq("active", true).maybeSingle();
  const { data: business } = await access.admin.schema("mediasis").from("businesses")
    .select("full_name").eq("uid", access.businessId).maybeSingle();
  if (data.mode === "scheduled" && card?.cardholder_email) {
    await sendSubscriptionBillingEmail({ to: card.cardholder_email, businessName: business?.full_name ?? "tu negocio",
      event: "plan_scheduled",
      idempotencyKey: `plan-change-${data.change_id}-${data.mode}-${data.request_version}` }).catch(() => null);
  }
  revalidatePath("/admin/settings/billing");
  return { success: true, message: data.mode === "trial" ? "Plan actualizado; tu prueba termina en la fecha original."
    : "Cambio programado para tu próxima renovación." };
}

export async function cancelScheduledPlanChange(changeType: "plan" | "cadence") {
  const access = await requireBillingAccess(true);
  if (!access.success || !access.context.appUserId) return { success: false, message: "No tenés acceso a este cambio." };
  const { data, error } = await access.admin.schema("mediasis").rpc("cancel_business_subscription_change", {
    p_owner_app_user_id: access.context.appUserId,
    p_business_id: access.businessId,
    p_change_type: changeType,
  });
  if (error || !data?.success) return { success: false, message: data?.message ?? "No se pudo cancelar el cambio." };
  revalidatePath("/admin/settings/billing");
  return { success: true, message: "Cambio programado cancelado." };
}
