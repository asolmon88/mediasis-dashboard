"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { synchronizeClerkIdentity } from "@/lib/dashboard/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTilopaySdkToken } from "@/lib/tilopay/billing";

const cardAliasSchema = z.string().trim().max(60, "El nombre puede tener hasta 60 caracteres.");

async function getOnboardingOwner(businessId: string) {
  const session = await auth();
  if (!session.userId) return { success: false as const, message: "Iniciá sesión para continuar." };
  await synchronizeClerkIdentity(session.userId);
  const admin = createAdminClient();
  const { data: user, error: userError } = await admin.schema("mediasis").from("app_users")
    .select("app_user_id,primary_email").eq("clerk_user_id", session.userId).maybeSingle();
  if (userError || !user?.app_user_id || !user.primary_email) return { success: false as const, message: "No se pudo validar tu cuenta Mediasis." };
  const { data: subscription, error: subscriptionError } = await admin.schema("mediasis").from("business_subscriptions")
    .select("business_id,status,owner_app_user_id").eq("business_id", businessId)
    .eq("owner_app_user_id", user.app_user_id).maybeSingle();
  if (subscriptionError || !subscription || subscription.status !== "awaiting_card") {
    return { success: false as const, message: "Esta configuración de pago ya no está disponible." };
  }
  return { success: true as const, admin, user };
}

export async function createOnboardingTilopaySdkToken(businessId: string) {
  const owner = await getOnboardingOwner(businessId);
  if (!owner.success) return owner;
  try {
    const { data: tokenization, error: tokenizationError } = await owner.admin.schema("mediasis")
      .from("business_card_tokenization_sessions")
      .insert({
        business_id: businessId,
        owner_app_user_id: owner.user.app_user_id,
        billing_email: owner.user.primary_email!,
        flow: "onboarding_trial",
      })
      .select("business_card_tokenization_session_id,callback_secret")
      .single();
    if (tokenizationError || !tokenization) throw new Error("No se pudo preparar el registro seguro de la tarjeta.");
    const requestHeaders = await headers();
    const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (!host) throw new Error("No se pudo preparar el retorno seguro de la tarjeta.");
    const callback = new URL("/api/payments/tilopay/card-token-return", `${protocol}://${host}`);
    callback.searchParams.set("session", tokenization.business_card_tokenization_session_id);
    callback.searchParams.set("state", tokenization.callback_secret);
    const session = await createTilopaySdkToken();
    return {
      success: true as const,
      billingEmail: owner.user.primary_email!,
      sessionId: tokenization.business_card_tokenization_session_id,
      redirectUrl: callback.toString(),
      ...session,
    };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "No se pudo preparar el pago." };
  }
}

export async function authorizeOnboardingCardTokenization(businessId: string, sessionId: string, rawCardLabel: string) {
  const owner = await getOnboardingOwner(businessId);
  if (!owner.success) return owner;
  const label = cardAliasSchema.safeParse(rawCardLabel);
  if (!label.success) return { success: false as const, message: label.error.issues[0]?.message ?? "Nombre inválido." };
  const { data, error } = await owner.admin.schema("mediasis").from("business_card_tokenization_sessions")
    .update({ recurring_consent_at: new Date().toISOString(), card_label: label.data || null })
    .eq("business_card_tokenization_session_id", sessionId)
    .eq("business_id", businessId)
    .eq("owner_app_user_id", owner.user.app_user_id)
    .eq("flow", "onboarding_trial")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("business_card_tokenization_session_id")
    .maybeSingle();
  if (error || !data) return { success: false as const, message: "Esta verificación de tarjeta venció. Actualizá la página e intentá de nuevo." };
  return { success: true as const };
}

export async function activateOnboardingSubscription(input: {
  businessId: string;
  cardToken: string;
  cardBrand?: string;
  cardLabel?: string;
}) {
  const owner = await getOnboardingOwner(input.businessId);
  if (!owner.success) return owner;
  const { admin, user } = owner;
  const { data, error } = await admin.schema("mediasis").rpc("activate_business_subscription_trial", {
    p_owner_app_user_id: user.app_user_id,
    p_business_id: input.businessId,
    p_card_token: input.cardToken,
    p_cardholder_email: user.primary_email,
    p_card_brand: input.cardBrand ?? "",
    p_card_label: input.cardLabel ?? "",
    p_consent_version: "2026-10-05",
  });
  if (error || !data?.success) return { success: false, message: error?.message ?? "No se pudo activar tu prueba gratis." };
  revalidatePath("/admin");
  return { success: true, message: "Tu tarjeta fue confirmada. Ya podés comenzar tu prueba gratis." };
}
