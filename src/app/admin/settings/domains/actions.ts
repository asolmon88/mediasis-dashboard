"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkCloudflareDomain, getCloudflareRegisteredDomain, registerCloudflareDomain, searchCloudflareDomains } from "@/lib/cloudflare/registrar";
import { ensurePurchasedDomainDns } from "@/lib/cloudflare/dns";
import { requireDomainAccess } from "@/lib/dashboard/domain-authorization";
import { getOnvoPlatformConfig, verifyOnvoPlatformCard } from "@/lib/onvo/platform-billing";
import { classifyTilopayTransaction, consultTilopayLifecycle, createTilopaySdkToken } from "@/lib/tilopay/billing";
import { attachOrderingAppDomain, detachOrderingAppDomains } from "@/lib/vercel/domains";
import { reconcileDomainPurchase } from "@/lib/domains/reconcile-domain-purchase";
import { calculateDomainPurchasePrice } from "@/lib/domains/pricing";

const domainSchema = z.string().trim().toLowerCase().max(253).transform((value) => value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "")).refine((value) => /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value), "Ingresá un dominio válido, por ejemplo farmacia.com.");
const contactSchema = z.object({ firstName: z.string().trim().min(1), lastName: z.string().trim().min(1), email: z.string().trim().email(), phone: z.string().trim().min(6), address: z.string().trim().min(3), city: z.string().trim().min(2), state: z.string().trim().min(2), country: z.string().trim().length(2).transform((v) => v.toUpperCase()), postalCode: z.string().trim().min(2) });
const domainCardSchema = z.object({ paymentMethodId: z.string().min(1), customerId: z.string().min(1), label: z.string().trim().max(60), submissionKey: z.string().regex(/^domain-card-[0-9a-f-]{36}$/) });

/** Staff cards are personal domain-purchase cards, not merchant subscription cards. */
export async function getUberDomainCardSetup(submissionKey: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  if (authorized.context.mode !== "staff" || !authorized.mediasisManaged || !authorized.context.appUserId) return { success: false as const, message: "Solo el equipo de Mediasis puede agregar una tarjeta para dominios Uber." };
  if (!/^domain-card-[0-9a-f-]{36}$/.test(submissionKey)) return { success: false as const, message: "Solicitud inválida." };
  try {
    const db = authorized.admin;
    const { count, error: countError } = await db.schema("mediasis").from("platform_billing_owner_cards")
      .select("owner_card_id", { count: "exact", head: true }).eq("owner_app_user_id", authorized.context.appUserId).is("removed_at", null);
    if (countError) throw countError;
    if ((count ?? 0) >= 3) throw new Error("Ya tenés tres tarjetas guardadas.");
    const { data: limit, error: limitError } = await db.schema("mediasis").rpc("reserve_onvo_owner_submission", {
      p_owner_app_user_id: authorized.context.appUserId, p_business_id: authorized.businessId,
      p_kind: "card_add", p_submission_key: submissionKey,
    });
    if (limitError) throw limitError;
    if (!limit?.success) throw new Error(`Llegaste al límite de cinco intentos. Podés volver a intentar después de ${new Date(limit.retry_at).toLocaleString("es-CR")}.`);
    const config = await getOnvoPlatformConfig(db, authorized.businessId);
    const { data: market } = await db.schema("mediasis").from("business_market_settings")
      .select("country_code").eq("business_id", authorized.businessId).maybeSingle();
    return { success: true as const, publishableKey: config.publishableKey, countryCode: market?.country_code ?? "CR" };
  } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo preparar la tarjeta." }; }
}

export async function saveUberDomainCard(raw: { paymentMethodId: string; customerId: string; label: string; submissionKey: string }) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  if (authorized.context.mode !== "staff" || !authorized.mediasisManaged || !authorized.context.appUserId) return { success: false as const, message: "Solo el equipo de Mediasis puede guardar una tarjeta para dominios Uber." };
  const parsed = domainCardSchema.safeParse(raw);
  if (!parsed.success) return { success: false as const, message: "Solicitud de tarjeta inválida." };
  try {
    const db = authorized.admin;
    const { error: consumeError } = await db.schema("mediasis").rpc("consume_onvo_owner_card_submission", {
      p_owner_app_user_id: authorized.context.appUserId, p_business_id: authorized.businessId,
      p_submission_key: parsed.data.submissionKey,
    });
    if (consumeError) throw consumeError;
    const config = await getOnvoPlatformConfig(db, authorized.businessId);
    const verified = await verifyOnvoPlatformCard({ secretKey: config.secretKey,
      paymentMethodId: parsed.data.paymentMethodId, customerId: parsed.data.customerId });
    const { data, error } = await db.schema("mediasis").rpc("add_onvo_staff_domain_wallet_card", {
      p_business_id: authorized.businessId, p_staff_app_user_id: authorized.context.appUserId,
      p_customer_id: verified.customerId, p_payment_method_id: parsed.data.paymentMethodId,
      p_email: authorized.context.user.email, p_brand: verified.brand ?? "", p_last4: verified.last4,
      p_label: parsed.data.label,
    });
    if (error || !data?.success) throw new Error(error?.message ?? "No se pudo guardar la tarjeta.");
    revalidatePath("/admin/settings/domains");
    return { success: true as const, message: "Tarjeta guardada en tu cuenta de IT para compras de dominios. No se vinculó a la suscripción del negocio." };
  } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo guardar la tarjeta." }; }
}

export async function removeUberDomainCard(cardId: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  if (authorized.context.mode !== "staff" || !authorized.mediasisManaged || !authorized.context.appUserId || !z.string().uuid().safeParse(cardId).success)
    return { success: false as const, message: "No se pudo verificar la tarjeta de IT." };
  const { data, error } = await authorized.admin.schema("mediasis").rpc("remove_onvo_staff_domain_wallet_card", {
    p_staff_app_user_id: authorized.context.appUserId, p_owner_card_id: cardId,
  });
  if (error || !data?.success) return { success: false as const, message: error?.message ?? "No se pudo quitar la tarjeta." };
  revalidatePath("/admin/settings/domains");
  return { success: true as const, message: "Tarjeta quitada de tu cuenta de IT." };
}

const domains = (admin: unknown) => (admin as any).schema("mediasis").from("storefront_domains");

type OnvoIntent = {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  metadata?: { localReference?: string; businessId?: string };
  lastPaymentError?: { message?: string | null } | null;
  charges?: Array<{ failureMessage?: string | null }> | null;
};

async function onvoPost(secretKey: string, path: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.onvopay.com/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Onvo no pudo autorizar la compra.");
  return data as OnvoIntent;
}

async function onvoGet(secretKey: string, path: string) {
  const response = await fetch(`https://api.onvopay.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Onvo no pudo consultar la autorización.");
  return data as OnvoIntent;
}

function onvoAuthorizationResult(intent: OnvoIntent, publishableKey: string) {
  if (intent.status === "requires_capture") return { success: true as const, message: "Onvo aprobó la autorización. El dominio está listo para registrarse y capturar el pago." };
  if (intent.status === "requires_action" && intent.id) return {
    success: false as const, message: "Tu banco necesita verificar esta compra. Completá la autenticación para continuar.",
    nextAction: { type: "3ds" as const, paymentIntentId: intent.id, publishableKey },
  };
  const rejection = intent.lastPaymentError?.message ?? intent.charges?.find((charge) => charge.failureMessage)?.failureMessage;
  if (["requires_payment_method", "failed", "canceled"].includes(intent.status ?? "")) return { success: false as const, message: rejection ?? "Onvo rechazó la autorización. Revisá la tarjeta e intentá de nuevo." };
  return { success: false as const, message: "Onvo requiere una acción adicional para esta autorización." };
}

function verifyDomainIntent(intent: OnvoIntent, expected: { id: string; amount: number; currency: string; localReference: string; businessId: string }) {
  if (intent.id !== expected.id || Number(intent.amount) !== expected.amount || intent.currency !== expected.currency
    || intent.metadata?.localReference !== expected.localReference || intent.metadata?.businessId !== expected.businessId) {
    throw new Error("La autorización de Onvo no coincide con esta compra. No se registrará el dominio.");
  }
}

async function finishAuthorizedOnvoDomainPurchase(db: any, businessId: string, attemptId: string, mappingId: string, intentId: string, secretKey: string) {
  const { data: attempt, error } = await db.schema("mediasis").from("storefront_domain_purchase_attempts").select("*").eq("storefront_domain_purchase_attempt_id", attemptId).eq("business_id", businessId).single();
  if (error || !attempt || attempt.state !== "authorized") throw new Error("No se pudo continuar la compra autorizada.");
  const now = new Date().toISOString();
  let registrationClaimed = false;
  try {
    if (attempt.registration_requested_at) return { success: true as const, message: "El registro del dominio ya está en curso. No se realizará un segundo intento." };
    const offer = await checkCloudflareDomain(attempt.requested_domain);
    if (offer.priceMinor !== attempt.cloudflare_price_minor || offer.currency !== attempt.currency) throw new Error("El precio del registrador cambió después de autorizar el pago.");
    const { data: claimed, error: claimError } = await db.schema("mediasis").from("storefront_domain_purchase_attempts")
      .update({ state: "registering", registration_requested_at: now, reconciliation_next_at: new Date(Date.now() + 60_000).toISOString() })
      .eq("storefront_domain_purchase_attempt_id", attemptId).eq("state", "authorized").is("registration_requested_at", null)
      .select("storefront_domain_purchase_attempt_id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return { success: true as const, message: "El registro del dominio ya está en curso. No se realizará un segundo intento." };
    registrationClaimed = true;
    const registration = await registerCloudflareDomain(attempt.requested_domain);
    if (!registration.completed || registration.state !== "succeeded") {
      await db.schema("mediasis").from("storefront_domain_purchase_attempts").update({ state: "registration_pending", cloudflare_workflow_url: registration.links?.self ?? null, payment_failure_category: "registration_pending" }).eq("storefront_domain_purchase_attempt_id", attemptId);
      return { success: true as const, message: "Onvo autorizó el pago; Cloudflare está registrando el dominio." };
    }
    const registered = await getCloudflareRegisteredDomain(attempt.requested_domain);
    if (registered.status !== "active") throw new Error("Cloudflare no confirmó el dominio registrado.");
    let setup = await prepareDomain(attempt.requested_domain);
    await ensurePurchasedDomainDns(attempt.requested_domain, setup.vercel.records);
    // Re-read Vercel after the managed DNS records are in place so the saved
    // domain shows its actual setup state instead of the pre-DNS state.
    setup = await prepareDomain(attempt.requested_domain, true);
    const { count: primaryCount, error: primaryCountError } = await db.schema("mediasis").from("storefront_domains")
      .select("storefront_domain_id", { count: "exact", head: true })
      .eq("business_id", businessId).eq("is_primary", true).is("disconnected_at", null);
    if (primaryCountError) throw primaryCountError;
    const shouldBePrimary = (primaryCount ?? 0) === 0;
    const { data: domain, error: domainError } = await db.schema("mediasis").from("storefront_domains").upsert({ business_id: businessId, apex_domain: attempt.requested_domain, www_domain: setup.vercel.alias, source: "purchased", registrar: "cloudflare", registrar_reference: registered.domain_name, verification_status: setup.verificationStatus, is_primary: shouldBePrimary, expires_at: registered.expires_at ?? null, registered_at: now, dns_requirements: setup.vercel.records, verification_details: { managed_hostnames: setup.vercel.managedHostnames, dns_configured: setup.vercel.dnsConfigured } }, { onConflict: "business_id,apex_domain" }).select("storefront_domain_id").single();
    if (domainError || !domain) throw domainError ?? new Error("No se pudo guardar el dominio.");
    if (shouldBePrimary && setup.verificationStatus === "active") await syncLegacyPrimary(businessId, attempt.requested_domain, db);
    await db.schema("mediasis").from("storefront_domain_purchase_attempts").update({ storefront_domain_id: domain.storefront_domain_id, cloudflare_registration_reference: registered.domain_name, capture_requested_at: new Date().toISOString() }).eq("storefront_domain_purchase_attempt_id", attemptId);
    const captured = await onvoPost(secretKey, "/payment-intents/" + encodeURIComponent(intentId) + "/capture", {});
    if (captured.status !== "succeeded") throw new Error("Onvo no confirmó la captura.");
    await db.schema("mediasis").from("platform_billing_payment_attempts").update({ state: "succeeded", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("platform_billing_payment_attempt_id", mappingId);
    await db.schema("mediasis").from("business_billing_transactions").update({ status: "paid", occurred_at: new Date().toISOString() }).eq("billing_transaction_id", attempt.billing_transaction_id);
    await db.schema("mediasis").from("storefront_domain_purchase_attempts").update({ state: "registered", onvo_capture_reference: captured.id ?? intentId, completed_at: new Date().toISOString(), reconciliation_next_at: null }).eq("storefront_domain_purchase_attempt_id", attemptId);
    return { success: true as const, message: "Dominio registrado y pago capturado con Onvo." };
  } catch (cause) {
    if (!registrationClaimed) return { success: false as const, message: cause instanceof Error ? cause.message : "No se pudo iniciar el registro. Consultá el estado antes de reintentar." };
    await onvoPost(secretKey, "/payment-intents/" + encodeURIComponent(intentId) + "/cancel", {}).catch(() => undefined);
    await db.schema("mediasis").from("storefront_domain_purchase_attempts").update({ state: "failed", payment_failure_category: "registration_failed", failure_reason: cause instanceof Error ? cause.message : "Falló el registro", reconciliation_next_at: null }).eq("storefront_domain_purchase_attempt_id", attemptId);
    await db.schema("mediasis").from("platform_billing_payment_attempts").update({ state: "canceled", updated_at: new Date().toISOString() }).eq("platform_billing_payment_attempt_id", mappingId);
    return { success: false as const, message: "No se pudo registrar el dominio; se canceló la autorización de Onvo." };
  }
}

type DnsRequirement = { provider: string; type: string; host: string; hostname?: string; zone?: string; value: string; purpose: string };

async function storefrontHttpsReady(hostname: string) {
  try {
    const response = await fetch(`https://${hostname}`, { method: "HEAD", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(12_000) });
    return response.status > 0 && response.status < 500;
  } catch { return false; }
}

async function prepareDomain(hostname: string, includeReadinessCheck = false) {
  const vercel = await attachOrderingAppDomain(hostname);
  const httpsReady = !includeReadinessCheck || !(vercel.verified && vercel.dnsConfigured) || await storefrontHttpsReady(hostname);
  const verificationStatus = !vercel.verified ? "dns_pending" : !vercel.dnsConfigured ? "vercel_pending" : !httpsReady ? "vercel_pending" : "active";
  return { vercel, verificationStatus, httpsReady };
}

async function removeGeneratedAliases(details: unknown) {
  const cleanup = (details as { cleanup_hostnames?: unknown } | null)?.cleanup_hostnames;
  const hostnames = Array.isArray(cleanup) ? cleanup.filter((hostname): hostname is string => typeof hostname === "string") : [];
  if (hostnames.length) await detachOrderingAppDomains(hostnames);
}

function domainWords(name: string) {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g)?.filter((word) => word.length > 2) ?? [];
}

async function allowedExpressAppDomain(rawDomain: string, businessId: string, admin: unknown) {
  const parsed = domainSchema.safeParse(rawDomain);
  if (!parsed.success || !parsed.data.endsWith("express.app") || parsed.data === "express.app") return false;
  const { data: business } = await (admin as any).schema("mediasis").from("businesses").select("full_name").eq("uid", businessId).maybeSingle();
  const words = domainWords(business?.full_name ?? "");
  const prefix = parsed.data.slice(0, -"express.app".length);
  return words.some((word) => prefix.includes(word));
}

async function countAvailable(businessId: string, admin: unknown) {
  const { count, error } = await domains(admin).select("storefront_domain_id", { count: "exact", head: true }).eq("business_id", businessId).is("disconnected_at", null);
  if (error) throw new Error("No se pudieron verificar los dominios existentes.");
  return count ?? 0;
}

async function hasOpenDomainPurchaseAttempt(businessId: string, admin: unknown) {
  const { data, error } = await (admin as any).schema("mediasis").from("storefront_domain_purchase_attempts")
    .select("storefront_domain_purchase_attempt_id,requested_domain,state,tilopay_order_number,billing_transaction_id,total_minor,currency,created_at")
    .eq("business_id", businessId)
    .in("state", ["created", "authorization_pending", "authorized", "registering", "registration_pending", "capture_failed"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("No se pudo verificar el estado de la compra anterior.");
  const attempts = (data ?? []) as Array<{ storefront_domain_purchase_attempt_id: string; requested_domain: string; state: string; tilopay_order_number: string; billing_transaction_id: string | null; total_minor: number; currency: string; created_at: string }>;

  for (const attempt of attempts) {
    if (attempt.state === "created") {
      // Creating the processor session only prepares card entry. It is not an
      // authorization and must never prevent the owner from returning to the
      // checkout or choosing a different saved card. The atomic state change
      // below cannot touch an attempt that has already been submitted.
      const { data: expired } = await (admin as any).schema("mediasis").from("storefront_domain_purchase_attempts")
        .update({ state: "failed", reconciliation_next_at: null, payment_failure_category: "checkout_expired" })
        .eq("storefront_domain_purchase_attempt_id", attempt.storefront_domain_purchase_attempt_id).eq("state", "created")
        .select("storefront_domain_purchase_attempt_id").maybeSingle();
      if (!expired) return attempt;
      if (attempt.billing_transaction_id) await (admin as any).schema("mediasis").from("business_billing_transactions")
        .update({ status: "failed" }).eq("billing_transaction_id", attempt.billing_transaction_id);
      continue;
    }
    if (attempt.state !== "authorization_pending") return attempt;
    // A browser may close before the return URL runs. Reconcile each pending
    // authorization with Tilopay before blocking the business from retrying.
    try {
      const lifecycle = await consultTilopayLifecycle(attempt.tilopay_order_number, attempt.total_minor, attempt.currency);
      if (lifecycle.capture) return attempt;
      const transaction = lifecycle.authorization;
      const outcome = classifyTilopayTransaction(transaction);
      if (outcome.status !== "declined") return attempt;
      await (admin as any).schema("mediasis").from("storefront_domain_purchase_attempts")
        .update({ state: "failed", payment_failure_category: outcome.failureCategory, tilopay_response_code: String(transaction?.code ?? ""), last_payment_verification_at: new Date().toISOString(), reconciliation_next_at: null, failure_reason: transaction?.response ?? "Tilopay rechazó el pago." })
        .eq("storefront_domain_purchase_attempt_id", attempt.storefront_domain_purchase_attempt_id);
      if (attempt.billing_transaction_id) await (admin as any).schema("mediasis").from("business_billing_transactions")
        .update({ status: "failed", occurred_at: new Date().toISOString() })
        .eq("billing_transaction_id", attempt.billing_transaction_id);
    } catch {
      return attempt;
    }
  }
  return null;
}

async function syncLegacyPrimary(businessId: string, apexDomain: string, admin: unknown) {
  await (admin as any).schema("mediasis").from("business_domain").delete().eq("business_uid", businessId).eq("type", "order_app").eq("is_internal_storefront", false);
  const { error } = await (admin as any).schema("mediasis").from("business_domain").insert({ business_uid: businessId, domain: apexDomain, type: "order_app" });
  if (error) throw new Error("No se pudo actualizar el dominio principal de la app de pedidos.");
}

async function hasLegacyOrderAppDomain(businessId: string, admin: unknown) {
  const { data, error } = await (admin as any).schema("mediasis").from("business_domain")
    .select("business_domain_id").eq("business_uid", businessId).eq("type", "order_app").eq("is_internal_storefront", false).limit(1).maybeSingle();
  if (error) throw new Error("No se pudo comprobar el dominio de la app de pedidos.");
  return Boolean(data);
}

async function cashbackEnabled(authorized: Extract<Awaited<ReturnType<typeof requireDomainAccess>>, { success: true }>) {
  const { data, error } = await (authorized.admin as any).schema("mediasis").rpc("get_ordering_app_cashback_settings", {
    p_business_id: authorized.businessId,
    p_actor_app_user_id: authorized.context.mode === "clerk" ? authorized.context.appUserId : null,
  });
  return !error && data?.success === true && data?.data?.enabled === true;
}

export async function getStorefrontDomains() {
  const authorized = await requireDomainAccess();
  if (!authorized.success) return { success: false as const, message: authorized.message };
  const { data, error } = await domains(authorized.admin).select("*").eq("business_id", authorized.businessId).order("is_primary", { ascending: false }).order("created_at", { ascending: true });
  if (error) return { success: false as const, message: "No se pudieron cargar los dominios." };
  return { success: true as const, domains: data ?? [], canManage: authorized.canManage };
}

type DomainPurchaseOutcome = {
  orderNumber: string;
  domain: string;
  amount: string;
  paymentStatus: "declined" | "authorized" | "captured" | "unknown";
  domainStatus: "not_started" | "registration_pending" | "registered" | "attention";
  title: string;
  message: string;
  reference: string;
  receiptStatus: "sent" | "failed" | null;
};

const domainPurchaseMessages: Record<string, { title: string; message: string }> = {
  checkout_expired: { title: "La compra no se envió", message: "La autorización venció antes de enviar los datos de la tarjeta. No se capturó ningún cargo. Podés iniciar otra compra." },
  bank_unavailable: { title: "Tu banco no confirmó el pago", message: "No se capturó ningún cargo. Intentá con otra tarjeta o consultá con tu banco." },
  insufficient_funds: { title: "No hay fondos suficientes", message: "No se capturó ningún cargo. Usá otra tarjeta o agregá fondos e intentá de nuevo." },
  invalid_cvv: { title: "El código de seguridad no es válido", message: "No se capturó ningún cargo. Revisá el CVV e intentá de nuevo." },
  authentication_declined: { title: "Tu banco rechazó la confirmación de seguridad", message: "No se capturó ningún cargo. Intentá de nuevo o consultá con tu banco." },
  card_declined: { title: "Tu banco rechazó el pago", message: "No se capturó ningún cargo. Intentá con otra tarjeta o consultá con tu banco." },
  verification_unknown: { title: "Todavía no pudimos confirmar el pago", message: "No hagás otro intento todavía. Revisaremos el estado del pago antes de cobrar o registrar el dominio." },
  registration_pending: { title: "El pago fue autorizado", message: "El registro del dominio sigue en proceso. Aún no capturamos el cargo." },
  registration_failed: { title: "El pago fue autorizado", message: "No pudimos terminar el registro del dominio. Aún no capturamos el cargo; nuestro equipo debe revisarlo." },
  capture_failed: { title: "Estamos verificando el cobro", message: "El pago fue autorizado, pero aún debemos confirmar si se capturó. No iniciés otra compra mientras lo revisamos." },
};

/** Returns only the current business's payment outcome for the post-payment page. */
export async function getDomainPurchaseOutcome(orderNumber?: string): Promise<DomainPurchaseOutcome | null> {
  if (!orderNumber?.startsWith("DOM-")) return null;
  const authorized = await requireDomainAccess();
  if (!authorized.success) return null;
  const { data: attempt, error } = await (authorized.admin as any).schema("mediasis").from("storefront_domain_purchase_attempts")
    .select("tilopay_order_number,requested_domain,total_minor,currency,state,payment_failure_category,tilopay_capture_reference,billing_transaction_id,simulated_registration,created_at")
    .eq("business_id", authorized.businessId)
    .eq("tilopay_order_number", orderNumber)
    .maybeSingle();
  if (error || !attempt) return null;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: attempt.currency ?? "USD" }).format(Number(attempt.total_minor) / 100);
  const reference = attempt.tilopay_order_number;
  const { data: receipt } = attempt.billing_transaction_id ? await (authorized.admin as any).schema("mediasis").from("business_billing_receipts")
    .select("email_delivery_status").eq("billing_transaction_id", attempt.billing_transaction_id).maybeSingle() : { data: null };
  const receiptStatus = receipt?.email_delivery_status === "sent" || receipt?.email_delivery_status === "failed" ? receipt.email_delivery_status : null;
  if (attempt.tilopay_capture_reference) return { orderNumber, domain: attempt.requested_domain, amount, paymentStatus: "captured", domainStatus: attempt.state === "registered" && !attempt.simulated_registration ? "registered" : "attention", title: attempt.simulated_registration ? "Pago de prueba completado" : attempt.state === "registered" ? "Compra completada" : "Cobro confirmado; registro en revisión", message: attempt.simulated_registration ? "El cobro de prueba fue confirmado. Este dominio no se registró durante la prueba local." : attempt.state !== "registered" ? "El cobro fue confirmado; estamos verificando el registro del dominio." : receiptStatus === "failed" ? "El pago fue capturado y el dominio ya está registrado. No pudimos enviar el comprobante por correo." : "El pago fue capturado y el dominio ya está registrado.", reference, receiptStatus };
  if ((attempt.state === "authorized" || attempt.state === "registering") && !attempt.payment_failure_category) return { orderNumber, domain: attempt.requested_domain, amount, paymentStatus: "authorized", domainStatus: "registration_pending", title: "Pago autorizado; registro en proceso", message: "Estamos registrando el dominio. Todavía no confirmamos la captura del cargo.", reference, receiptStatus };
  const category = typeof attempt.payment_failure_category === "string" ? attempt.payment_failure_category : attempt.state === "registration_pending" ? "registration_pending" : attempt.state === "capture_failed" ? "capture_failed" : "";
  const configured = domainPurchaseMessages[category];
  if (configured) {
    const paymentStatus = category === "capture_failed" || category === "verification_unknown" ? "unknown" : category === "registration_pending" || category === "registration_failed" ? "authorized" : "declined";
    const domainStatus = category === "registration_pending" ? "registration_pending" : category === "registration_failed" || category === "capture_failed" ? "attention" : "not_started";
    return { orderNumber, domain: attempt.requested_domain, amount, paymentStatus, domainStatus, ...configured, reference, receiptStatus };
  }
  return { orderNumber, domain: attempt.requested_domain, amount, paymentStatus: "unknown", domainStatus: "not_started", title: "Procesamos tu solicitud de pago", message: "Estamos verificando el resultado con Tilopay. No hagás otro intento todavía.", reference, receiptStatus };
}

export async function pollDomainPurchaseOutcome(orderNumber: string) {
  const authorized = await requireDomainAccess();
  if (!authorized.success || !/^DOM-[a-zA-Z0-9]+$/.test(orderNumber)) return null;
  const { data } = await (authorized.admin as any).schema("mediasis").from("storefront_domain_purchase_attempts")
    .select("storefront_domain_purchase_attempt_id")
    .eq("business_id", authorized.businessId).eq("tilopay_order_number", orderNumber).maybeSingle();
  if (!data) return null;
  await reconcileDomainPurchase(orderNumber);
  return getDomainPurchaseOutcome(orderNumber);
}

export async function searchDomains(rawPrefix?: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  const { data: business, error } = await (authorized.admin as any).schema("mediasis").from("businesses").select("full_name").eq("uid", authorized.businessId).maybeSingle();
  if (error || !business?.full_name) return { success: false as const, message: "No se pudo encontrar el nombre de la farmacia." };
  const words = domainWords(business.full_name);
  if (!words.length) return { success: false as const, message: "Actualizá el nombre de la farmacia antes de buscar un dominio." };
  try {
    const normalizedCustomPrefix = rawPrefix?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]/g, "") ?? "";
    if (rawPrefix && (!normalizedCustomPrefix || !words.some((word) => normalizedCustomPrefix.includes(word)))) return { success: false as const, message: "El nombre debe incluir una parte del nombre de tu farmacia." };
    const base = words.join("");
    const candidates = normalizedCustomPrefix ? [`${normalizedCustomPrefix}express.app`] : [
      `${base}express.app`,
      `${words[0]}express.app`,
      `${base}goexpress.app`,
      `${base}foodexpress.app`,
      `${words[0]}onlineexpress.app`,
      `${base}pedidosexpress.app`,
    ];
    const [suggested, checked] = await Promise.all([
      searchCloudflareDomains(`${base}express.app`),
      Promise.all(candidates.map((domain) => checkCloudflareDomain(domain).catch(() => null))),
    ]);
    const offers = [...checked.filter((offer): offer is NonNullable<typeof offer> => offer !== null), ...suggested]
      .filter((offer) => offer.domain.endsWith("express.app") && offer.domain !== "express.app" && words.some((word) => offer.domain.slice(0, -"express.app".length).includes(word)));
    const uniqueOffers = [...new Map(offers.map((offer) => [offer.domain, offer])).values()];
    return { success: true as const, offers: uniqueOffers.slice(0, normalizedCustomPrefix ? 10 : 3), message: uniqueOffers.length ? undefined : "No encontramos un dominio disponible con ese nombre." };
  }
  catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo buscar el dominio." }; }
}

export async function connectExistingDomain(rawDomain: string) {
  const parsed = domainSchema.safeParse(rawDomain);
  if (!parsed.success) return { success: false as const, message: parsed.error.issues[0]?.message ?? "Dominio inválido." };
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  try {
    if (await countAvailable(authorized.businessId, authorized.admin) >= 3) return { success: false as const, message: "Cada negocio puede guardar hasta tres dominios." };
    const apex = parsed.data;
    const setup = await prepareDomain(apex);
    const requirements: DnsRequirement[] = [...setup.vercel.records];
    const isCashbackEnabled = await cashbackEnabled(authorized);
    if (isCashbackEnabled) {
      requirements.push({ provider: "Cuentas de clientes", type: "Pendiente", host: "@", value: "Se preparará automáticamente al activar el cashback.", purpose: "Registro e inicio de sesión" });
    }
    const { data: existing, error: existingError } = await domains(authorized.admin).select("storefront_domain_id,disconnected_at").eq("business_id", authorized.businessId).eq("apex_domain", apex).maybeSingle();
    if (existingError) throw existingError;
    const shouldBecomePrimary = !await hasLegacyOrderAppDomain(authorized.businessId, authorized.admin);
    const { error } = existing
      ? await domains(authorized.admin).update({ source: "external", registrar: "external", verification_status: setup.verificationStatus, disconnected_at: null, is_primary: shouldBecomePrimary, www_domain: setup.vercel.alias, dns_requirements: requirements, verification_details: { managed_hostnames: setup.vercel.managedHostnames, dns_configured: setup.vercel.dnsConfigured }, last_error: null }).eq("storefront_domain_id", existing.storefront_domain_id)
      : await domains(authorized.admin).insert({ business_id: authorized.businessId, apex_domain: apex, www_domain: setup.vercel.alias, source: "external", registrar: "external", verification_status: setup.verificationStatus, is_primary: shouldBecomePrimary, dns_requirements: requirements, verification_details: { managed_hostnames: setup.vercel.managedHostnames, dns_configured: setup.vercel.dnsConfigured } });
    if (error) throw error;
    if (shouldBecomePrimary && setup.verificationStatus === "active") await syncLegacyPrimary(authorized.businessId, apex, authorized.admin);
    revalidatePath("/admin/settings/domains");
    return { success: true as const, message: existing ? "Dominio reconectado. Completá los registros DNS para activarlo." : "Dominio agregado. Completá los registros DNS para activarlo." };
  } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo conectar el dominio." }; }
}

export async function refreshDomainSetup(domainId: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  try {
    const { data: domain, error: lookupError } = await domains(authorized.admin).select("apex_domain,is_primary,source,verification_details").eq("storefront_domain_id", domainId).eq("business_id", authorized.businessId).maybeSingle();
    if (lookupError || !domain) return { success: false as const, message: "No se encontró el dominio." };
    if (domain.verification_details?.simulated_registration === true) return { success: false as const, message: "Este dominio pertenece a una prueba de pago y no fue registrado. Eliminá el registro de prueba antes de conectarlo." };
    await removeGeneratedAliases(domain.verification_details);
    let setup = await prepareDomain(domain.apex_domain, true);
    if (domain.source === "purchased") {
      await ensurePurchasedDomainDns(domain.apex_domain, setup.vercel.records);
      if (!setup.vercel.dnsConfigured) setup = await prepareDomain(domain.apex_domain, true);
    }
    const requirements: DnsRequirement[] = [...setup.vercel.records];
    if (await cashbackEnabled(authorized)) requirements.push({ provider: "Cuentas de clientes", type: "Pendiente", host: "@", value: "Se preparará automáticamente al activar el cashback.", purpose: "Registro e inicio de sesión" });
    const { error } = await domains(authorized.admin).update({ dns_requirements: requirements, verification_status: setup.verificationStatus, www_domain: setup.vercel.alias, verification_details: { managed_hostnames: setup.vercel.managedHostnames, dns_configured: setup.vercel.dnsConfigured, https_ready: setup.httpsReady }, activated_at: setup.verificationStatus === "active" ? new Date().toISOString() : null, last_error: null }).eq("storefront_domain_id", domainId).eq("business_id", authorized.businessId);
    if (error) throw error;
    if (setup.verificationStatus === "active" && domain.is_primary) await syncLegacyPrimary(authorized.businessId, domain.apex_domain, authorized.admin);
    revalidatePath("/admin/settings/domains");
    return { success: true as const, message: setup.verificationStatus === "active" ? "Dominio activo y listo para recibir pedidos." : domain.source === "purchased" ? "Estamos terminando de configurar tu dominio. Volvé a verificar en unos minutos." : !setup.vercel.verified ? "Agregá los registros DNS indicados y volvé a verificar." : !setup.vercel.dnsConfigured ? "La verificación está lista; falta dirigir el dominio a la app de pedidos." : "El DNS está listo. Esperamos que se active el certificado HTTPS." };
  } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo preparar el dominio." }; }
}

export async function setPrimaryDomain(domainId: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  const { data: domain, error } = await domains(authorized.admin).select("storefront_domain_id,apex_domain,verification_status,disconnected_at,verification_details").eq("storefront_domain_id", domainId).eq("business_id", authorized.businessId).maybeSingle();
  if (error || !domain) return { success: false as const, message: "No se encontró el dominio." };
  if (domain.verification_details?.simulated_registration === true) return { success: false as const, message: "Un dominio de prueba no puede ser el principal." };
  if (domain.verification_status !== "active" || domain.disconnected_at) return { success: false as const, message: "Activá el dominio antes de convertirlo en principal." };
  await domains(authorized.admin).update({ is_primary: false }).eq("business_id", authorized.businessId);
  const { error: updateError } = await domains(authorized.admin).update({ is_primary: true }).eq("storefront_domain_id", domainId);
  if (updateError) return { success: false as const, message: "No se pudo cambiar el dominio principal." };
  try { await syncLegacyPrimary(authorized.businessId, domain.apex_domain, authorized.admin); } catch (syncError) { return { success: false as const, message: syncError instanceof Error ? syncError.message : "No se pudo actualizar el storefront." }; }
  revalidatePath("/admin/settings/domains");
  return { success: true as const, message: "Dominio principal actualizado." };
}

export async function disconnectDomain(domainId: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  const { data: domain } = await domains(authorized.admin).select("is_primary,source,verification_details").eq("storefront_domain_id", domainId).eq("business_id", authorized.businessId).maybeSingle();
  if (!domain) return { success: false as const, message: "No se encontró el dominio." };
  if (domain.is_primary) return { success: false as const, message: "Elegí otro dominio principal antes de desconectarlo." };
  const managedHostnames = Array.isArray(domain.verification_details?.managed_hostnames) ? domain.verification_details.managed_hostnames.filter((hostname: unknown): hostname is string => typeof hostname === "string") : [];
  try {
    if (managedHostnames.length) await detachOrderingAppDomains(managedHostnames);
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? `No se pudo retirar la configuración del hosting: ${error.message}` : "No se pudo retirar la configuración del hosting." };
  }
  const { error } = await domains(authorized.admin).update({ verification_status: "disconnected", disconnected_at: new Date().toISOString(), is_primary: false }).eq("storefront_domain_id", domainId).eq("business_id", authorized.businessId);
  if (error) return { success: false as const, message: "No se pudo desconectar el dominio." };
  revalidatePath("/admin/settings/domains");
  return { success: true as const, message: domain.source === "purchased" ? "El dominio se desconectó. Su registro sigue siendo propiedad del negocio." : "Dominio desconectado." };
}

/** Removes Mediasis's record for an externally managed domain after it is disconnected. */
export async function removeExternalDomain(domainId: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  const { data: domain, error: lookupError } = await domains(authorized.admin)
    .select("source,disconnected_at,is_primary")
    .eq("storefront_domain_id", domainId)
    .eq("business_id", authorized.businessId)
    .maybeSingle();
  if (lookupError || !domain) return { success: false as const, message: "No se encontró el dominio." };
  if (domain.source !== "external") return { success: false as const, message: "Los dominios comprados con Mediasis se mantienen como propiedad del negocio." };
  if (!domain.disconnected_at || domain.is_primary) return { success: false as const, message: "Desconectá el dominio antes de eliminar su registro." };
  const { error } = await domains(authorized.admin)
    .delete()
    .eq("storefront_domain_id", domainId)
    .eq("business_id", authorized.businessId);
  if (error) return { success: false as const, message: "No se pudo eliminar el registro del dominio." };
  revalidatePath("/admin/settings/domains");
  return { success: true as const, message: "Se eliminó el dominio de este negocio. El dominio sigue administrado por su proveedor externo." };
}

export async function beginDomainPurchase(rawDomain: string, rawContact: z.input<typeof contactSchema>) {
  const domainResult = domainSchema.safeParse(rawDomain); const contactResult = contactSchema.safeParse(rawContact);
  if (!domainResult.success || !contactResult.success) return { success: false as const, message: domainResult.error?.issues[0]?.message ?? contactResult.error?.issues[0]?.message ?? "Revisá los datos de registro." };
  const authorized = await requireDomainAccess(true);
  if (!authorized.success) return { success: false as const, message: authorized.message };
  try {
    if (process.env.NODE_ENV === "production" && !process.env.CRON_SECRET) return { success: false as const, message: "Las compras de dominio no están disponibles hasta configurar la recuperación de pagos." };
    if (await countAvailable(authorized.businessId, authorized.admin) >= 3) return { success: false as const, message: "Cada negocio puede guardar hasta tres dominios." };
    const openAttempt = await hasOpenDomainPurchaseAttempt(authorized.businessId, authorized.admin);
    if (openAttempt) return { success: false as const, message: `Ya hay una compra en proceso para ${openAttempt.requested_domain}. Revisá su estado antes de iniciar otra compra.` };
    const offer = await checkCloudflareDomain(domainResult.data);
    const tilopay = await createTilopaySdkToken();
    const orderNumber = `DOM-${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
    const domainPrice = calculateDomainPurchasePrice(offer.priceMinor);
    const totalMinor = domainPrice.totalMinor;
    const db = authorized.admin as any;
    const { data: transaction, error: transactionError } = await db.schema("mediasis").from("business_billing_transactions").insert({ business_id: authorized.businessId, charge_type: "domain_purchase", status: "pending", amount_minor: totalMinor, currency_code: "USD", provider: "tilopay", provider_reference: orderNumber, description: `Registro de ${offer.domain}` }).select("billing_transaction_id").single();
    if (transactionError) throw transactionError;
    const { data: attempt, error: attemptError } = await db.schema("mediasis").from("storefront_domain_purchase_attempts").insert({ business_id: authorized.businessId, billing_transaction_id: transaction.billing_transaction_id, requested_domain: offer.domain, cloudflare_price_minor: domainPrice.registrarMinor, markup_minor: domainPrice.serviceMarginMinor, processor_fee_minor: domainPrice.processorFeeMinor, total_minor: totalMinor, currency: "USD", registration_years: offer.registrationYears, tilopay_order_number: orderNumber, registrant_contact: { managed_by: "mediasis" }, customer_contact: contactResult.data, ownership_model: "mediasis_managed", idempotency_key: crypto.randomUUID(), state: "created", reconciliation_next_at: new Date(Date.now() + 15 * 60_000).toISOString() }).select("storefront_domain_purchase_attempt_id").single();
    if (attemptError) throw attemptError;
    return { success: true as const, attemptId: attempt.storefront_domain_purchase_attempt_id, token: tilopay.token, orderNumber, amount: (totalMinor / 100).toFixed(2), domain: offer.domain, message: "Confirmá la autorización con Tilopay. El cargo se captura solo después de registrar el dominio." };
  } catch (error) { return { success: false as const, message: error instanceof Error ? error.message : "No se pudo preparar la compra." }; }
}

/**
 * Creates the durable local obligation before any call to Onvo. Card details
 * never pass through this action; authorization happens later with the saved
 * opaque Onvo payment-method id.
 */
export async function beginOnvoDomainPurchase(rawDomain: string, rawContact: z.input<typeof contactSchema>) {
  const domainResult = domainSchema.safeParse(rawDomain);
  const contactResult = contactSchema.safeParse(rawContact);
  if (!domainResult.success || !contactResult.success) {
    return { success: false as const, message: domainResult.error?.issues[0]?.message ?? contactResult.error?.issues[0]?.message ?? "Revisá los datos de registro." };
  }
  const authorized = await requireDomainAccess(true);
  if (!authorized.success || !authorized.context.appUserId) {
    return { success: false as const, message: authorized.success ? "No se pudo identificar la cuenta propietaria." : authorized.message };
  }
  try {
    if (await countAvailable(authorized.businessId, authorized.admin) >= 3) {
      return { success: false as const, message: "Cada negocio puede guardar hasta tres dominios." };
    }
    // Reaching card selection only creates a local draft. It must not block a
    // later attempt when no authorization was ever submitted.
    const openAttempt = await hasOpenDomainPurchaseAttempt(authorized.businessId, authorized.admin);
    if (openAttempt) {
      return { success: false as const, message: `Hay una compra en proceso para ${openAttempt.requested_domain}. Revisá su estado antes de iniciar otra compra.` };
    }
    const offer = await checkCloudflareDomain(domainResult.data);
    const price = calculateDomainPurchasePrice(offer.priceMinor);
    const reference = `DOM-${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
    const { data, error } = await (authorized.admin as any).schema("mediasis").rpc("begin_onvo_domain_purchase", {
      p_business_id: authorized.businessId,
      p_owner_id: authorized.context.appUserId,
      p_domain: offer.domain,
      p_registrar_minor: price.registrarMinor,
      p_margin_minor: price.serviceMarginMinor,
      p_fee_minor: price.processorFeeMinor,
      p_total_minor: price.totalMinor,
      p_currency: "USD",
      p_registration_years: offer.registrationYears,
      p_customer_contact: contactResult.data,
      p_local_reference: reference,
    });
    if (error || !data?.success) throw new Error(error?.message ?? "No se pudo preparar la compra.");
    return {
      success: true as const,
      orderNumber: reference,
      amount: (price.totalMinor / 100).toFixed(2),
      domain: offer.domain,
      message: "Elegí una tarjeta para autorizar la compra.",
    };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "No se pudo preparar la compra." };
  }
}

/**
 * Authorizes an owner-wallet card. The browser supplies only our local card ID;
 * ownership, Onvo account, and opaque processor IDs are checked server-side.
 * The durable attempt is claimed before Onvo is contacted.
 */
export async function authorizeOnvoDomainPurchase(orderNumber: string, ownerCardId: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success || !authorized.context.appUserId || !/^DOM-[a-zA-Z0-9]+$/.test(orderNumber)) {
    return { success: false as const, message: authorized.success ? "No se pudo autorizar esta compra." : authorized.message };
  }
  try {
    const db = authorized.admin as any;
    const { data: attempt, error: attemptError } = await db.schema("mediasis").from("storefront_domain_purchase_attempts")
      .select("storefront_domain_purchase_attempt_id,processor,state,total_minor,currency,requested_domain,local_reference,onvo_intent_id")
      .eq("business_id", authorized.businessId).eq("local_reference", orderNumber).maybeSingle();
    if (attemptError || !attempt || attempt.processor !== "onvo" || !["created", "authorization_pending", "authorized"].includes(attempt.state)) {
      return { success: false as const, message: "Esta autorización venció o ya está siendo procesada. Prepará una nueva compra." };
    }
    const { data: owner } = await db.schema("mediasis").from("business_account_owners")
      .select("owner_app_user_id").eq("business_id", authorized.businessId).maybeSingle();
    const staffManagedUber = authorized.context.mode === "staff" && authorized.mediasisManaged;
    if (owner?.owner_app_user_id !== authorized.context.appUserId && !staffManagedUber) {
      return { success: false as const, message: "Solo el propietario puede autorizar una compra con sus tarjetas. En planes Uber también puede hacerlo un administrador de Mediasis con su propia tarjeta." };
    }
    const { data: market } = await db.schema("mediasis").from("business_market_settings")
      .select("country_code").eq("business_id", authorized.businessId).maybeSingle();
    const { data: mapping, error: mappingError } = await db.schema("mediasis").from("platform_billing_payment_attempts")
      .select("platform_billing_payment_attempt_id,provider_intent_id,provider_payment_method_id").eq("storefront_domain_purchase_attempt_id", attempt.storefront_domain_purchase_attempt_id).single();
    if (mappingError || !mapping) throw new Error("No se encontró el intento de cobro.");
    const cardQuery = db.schema("mediasis").from("platform_billing_owner_cards")
      .select("provider_customer_id,provider_payment_method_id")
      .eq("owner_app_user_id", authorized.context.appUserId)
      .eq("country_code", market?.country_code ?? "CR").is("removed_at", null);
    const { data: card } = mapping.provider_intent_id
      ? await cardQuery.eq("provider_payment_method_id", mapping.provider_payment_method_id).maybeSingle()
      : await cardQuery.eq("owner_card_id", ownerCardId).maybeSingle();
    if (!card?.provider_customer_id || !card?.provider_payment_method_id) {
      return { success: false as const, message: "La tarjeta de esta autorización no está disponible en tu cuenta." };
    }
    const config = await getOnvoPlatformConfig(authorized.admin, authorized.businessId);
    let intent: OnvoIntent;
    if (mapping.provider_intent_id) {
      const existing = await onvoGet(config.secretKey, `/payment-intents/${encodeURIComponent(mapping.provider_intent_id)}`);
      verifyDomainIntent(existing, { id: mapping.provider_intent_id, amount: Number(attempt.total_minor), currency: attempt.currency,
        localReference: attempt.local_reference, businessId: authorized.businessId });
      const now = new Date().toISOString();
      const authorizedState = existing.status === "requires_capture";
      await db.schema("mediasis").from("platform_billing_payment_attempts")
        .update({ state: existing.status ?? "unknown", updated_at: now }).eq("platform_billing_payment_attempt_id", mapping.platform_billing_payment_attempt_id);
      await db.schema("mediasis").from("storefront_domain_purchase_attempts")
        .update({ state: authorizedState ? "authorized" : ["requires_payment_method", "failed", "canceled"].includes(existing.status ?? "") ? "failed" : "authorization_pending", reconciliation_next_at: authorizedState ? new Date(Date.now() + 20_000).toISOString() : null })
        .eq("storefront_domain_purchase_attempt_id", attempt.storefront_domain_purchase_attempt_id);
      if (authorizedState) return { ...(await finishAuthorizedOnvoDomainPurchase(db, authorized.businessId, attempt.storefront_domain_purchase_attempt_id, mapping.platform_billing_payment_attempt_id, mapping.provider_intent_id, config.secretKey)), orderNumber };
      return { ...onvoAuthorizationResult(existing, config.publishableKey), orderNumber };
    }
    if (attempt.state !== "created") return { success: false as const, message: "No se pudo encontrar una autorización de Onvo para esta compra." };
    await verifyOnvoPlatformCard({ secretKey: config.secretKey,
      paymentMethodId: card.provider_payment_method_id, customerId: card.provider_customer_id });
    const { data: limit, error: limitError } = await db.schema("mediasis").rpc("reserve_onvo_owner_submission", {
      p_owner_app_user_id: authorized.context.appUserId, p_business_id: authorized.businessId,
      p_kind: "payment", p_submission_key: `domain-${attempt.storefront_domain_purchase_attempt_id}`,
    });
    if (limitError) throw new Error(limitError.message);
    if (!limit?.success) return { success: false as const,
      message: `Llegaste al límite de cinco intentos. Podés volver a intentar después de ${new Date(limit.retry_at).toLocaleString("es-CR")}.` };
    const { data: claimed, error: claimError } = await db.schema("mediasis").from("storefront_domain_purchase_attempts")
      .update({ state: "authorization_pending" })
      .eq("storefront_domain_purchase_attempt_id", attempt.storefront_domain_purchase_attempt_id)
      .eq("state", "created").select("storefront_domain_purchase_attempt_id").maybeSingle();
    if (claimError || !claimed) return { success: false as const,
      message: "La autorización ya está en curso. Consultá el estado antes de enviarla de nuevo." };
    intent = await onvoPost(config.secretKey, "/payment-intents", {
      amount: Number(attempt.total_minor),
      currency: attempt.currency,
      customerId: card.provider_customer_id,
      captureMethod: "manual",
      description: `Registro de ${attempt.requested_domain}`,
      metadata: { localReference: attempt.local_reference, businessId: authorized.businessId },
    });
    if (!intent.id) throw new Error("Onvo no devolvió una intención de pago.");
    const { data: linked, error: linkError } = await db.schema("mediasis").from("platform_billing_payment_attempts")
      .update({ provider_intent_id: intent.id, provider_payment_method_id: card.provider_payment_method_id, state: intent.status ?? "creation_unknown", updated_at: new Date().toISOString() })
      .eq("platform_billing_payment_attempt_id", mapping.platform_billing_payment_attempt_id).is("provider_intent_id", null)
      .select("platform_billing_payment_attempt_id").maybeSingle();
    if (linkError || !linked) throw new Error("No se pudo guardar la autorización de forma segura. Revisaremos el intento antes de reintentar.");
    await onvoPost(config.secretKey, `/payment-intents/${encodeURIComponent(intent.id)}/confirm`, {
      paymentMethodId: card.provider_payment_method_id,
    });
    const confirmed = await onvoGet(config.secretKey, `/payment-intents/${encodeURIComponent(intent.id)}`);
    verifyDomainIntent(confirmed, { id: intent.id, amount: Number(attempt.total_minor), currency: attempt.currency,
      localReference: attempt.local_reference, businessId: authorized.businessId });
    const now = new Date().toISOString();
    const authorizedState = confirmed.status === "requires_capture";
    const rejectedState = ["requires_payment_method", "failed", "canceled"].includes(confirmed.status ?? "");
    await db.schema("mediasis").from("platform_billing_payment_attempts")
      .update({ state: confirmed.status ?? "unknown", updated_at: now }).eq("platform_billing_payment_attempt_id", mapping.platform_billing_payment_attempt_id);
    await db.schema("mediasis").from("storefront_domain_purchase_attempts")
      .update({ onvo_intent_id: intent.id, state: authorizedState ? "authorized" : rejectedState ? "failed" : "authorization_pending", reconciliation_next_at: authorizedState ? new Date(Date.now() + 20_000).toISOString() : null })
      .eq("storefront_domain_purchase_attempt_id", attempt.storefront_domain_purchase_attempt_id).eq("state", "authorization_pending");
    if (authorizedState) return { ...(await finishAuthorizedOnvoDomainPurchase(db, authorized.businessId, attempt.storefront_domain_purchase_attempt_id, mapping.platform_billing_payment_attempt_id, intent.id, config.secretKey)), orderNumber };
    return { ...onvoAuthorizationResult(confirmed, config.publishableKey), orderNumber };
  } catch (error) {
    return { success: false as const, message: error instanceof Error ? error.message : "No se pudo autorizar la compra." };
  }
}

export async function startDomainPaymentSubmission(orderNumber: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success || !/^DOM-[a-zA-Z0-9]+$/.test(orderNumber)) return { success: false as const, message: "No se pudo iniciar este pago." };
  const db = authorized.admin as any;
  const { data: attempt } = await db.schema("mediasis").from("storefront_domain_purchase_attempts")
    .select("storefront_domain_purchase_attempt_id,state,created_at")
    .eq("business_id", authorized.businessId).eq("tilopay_order_number", orderNumber).maybeSingle();
  if (!attempt || attempt.state !== "created" || Date.now() - new Date(attempt.created_at).getTime() >= 15 * 60_000) return { success: false as const, message: "Esta autorización venció. Prepará una nueva compra." };
  const { data, error } = await db.schema("mediasis").from("storefront_domain_purchase_attempts")
    .update({ state: "authorization_pending", reconciliation_next_at: new Date(Date.now() + 20_000).toISOString() })
    .eq("storefront_domain_purchase_attempt_id", attempt.storefront_domain_purchase_attempt_id).eq("state", "created")
    .select("storefront_domain_purchase_attempt_id").maybeSingle();
  return error || !data ? { success: false as const, message: "No se pudo iniciar este pago." } : { success: true as const };
}

export async function reportDomainPaymentSubmissionFailure(orderNumber: string) {
  const authorized = await requireDomainAccess(true);
  if (!authorized.success || !/^DOM-[a-zA-Z0-9]+$/.test(orderNumber)) return;
  await (authorized.admin as any).schema("mediasis").from("storefront_domain_purchase_attempts")
    .update({ failure_reason: "sdk_submission_failed", payment_failure_category: "verification_unknown", reconciliation_next_at: new Date(Date.now() + 30_000).toISOString() })
    .eq("business_id", authorized.businessId).eq("tilopay_order_number", orderNumber).eq("state", "authorization_pending");
}
