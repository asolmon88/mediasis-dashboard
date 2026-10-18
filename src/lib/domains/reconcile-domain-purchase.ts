import "server-only";

import { checkCloudflareDomain, CloudflareApiError, getCloudflareRegisteredDomain, getCloudflareRegistrationStatus, registerCloudflareDomain, type CloudflareRegistration } from "@/lib/cloudflare/registrar";
import { issueCompletedDomainPurchaseReceipt } from "@/lib/domains/domain-purchase-receipts";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureTilopayAuthorization, classifyTilopayTransaction, consultTilopayLifecycle } from "@/lib/tilopay/billing";
import { attachOrderingAppDomain } from "@/lib/vercel/domains";
import { ensurePurchasedDomainDns } from "@/lib/cloudflare/dns";

const retryAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const table = (admin: ReturnType<typeof createAdminClient>) => admin.schema("mediasis").from("storefront_domain_purchase_attempts");
type Attempt = Record<string, any>;

async function storefrontHttpsReady(hostname: string) {
  try {
    const response = await fetch(`https://${hostname}`, { method: "HEAD", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(12_000) });
    return response.status > 0 && response.status < 500;
  } catch { return false; }
}

async function update(admin: ReturnType<typeof createAdminClient>, id: string, values: Record<string, unknown>) {
  const { error } = await table(admin).update(values).eq("storefront_domain_purchase_attempt_id", id);
  if (error) throw error;
}

async function markCaptured(admin: ReturnType<typeof createAdminClient>, attempt: Attempt, reference: string) {
  const id = attempt.storefront_domain_purchase_attempt_id;
  await update(admin, id, { tilopay_capture_reference: reference, last_payment_verification_at: new Date().toISOString(), payment_failure_category: null, failure_reason: null, reconciliation_next_at: retryAt(30) });
  if (attempt.billing_transaction_id) {
    const { error } = await admin.schema("mediasis").from("business_billing_transactions")
      .update({ status: "paid", occurred_at: new Date().toISOString() }).eq("billing_transaction_id", attempt.billing_transaction_id);
    if (error) throw error;
  }
  if (!attempt.storefront_domain_id) return false;
  // A payment and domain are separate facts. Historical local simulations
  // must never be treated as a real registrar purchase.
  if (!attempt.cloudflare_registration_reference || attempt.simulated_registration) return false;
  const { data: storefront, error: storefrontError } = await admin.schema("mediasis").from("storefront_domains")
    .select("is_primary,verification_status").eq("storefront_domain_id", attempt.storefront_domain_id).maybeSingle();
  if (storefrontError || !storefront) return false;
  if (storefront?.is_primary && storefront.verification_status === "active") {
    const { data: legacy } = await admin.schema("mediasis").from("business_domain")
      .select("business_domain_id").eq("business_uid", attempt.business_id).eq("type", "order_app").eq("is_internal_storefront", false).maybeSingle();
    if (!legacy) {
      const { error } = await admin.schema("mediasis").from("business_domain")
        .insert({ business_uid: attempt.business_id, domain: attempt.requested_domain, type: "order_app" });
      if (error) throw error;
    }
  }
  await update(admin, id, { state: "registered", completed_at: new Date().toISOString(), reconciliation_next_at: null });
  if (!attempt.billing_transaction_id) return true;
  try {
    const receipt = await issueCompletedDomainPurchaseReceipt(attempt.billing_transaction_id, admin);
    await update(admin, id, { receipt_retry_at: receipt.sent ? null : retryAt(300) });
  } catch (error) {
    console.error("Domain receipt delivery requires retry", { orderNumber: attempt.tilopay_order_number, error });
    await update(admin, id, { receipt_retry_at: retryAt(300) });
  }
  return true;
}

/** Shared by redirect, authenticated polling and the scheduled recovery route. */
export async function reconcileDomainPurchase(orderNumber: string) {
  if (!/^DOM-[a-zA-Z0-9]+$/.test(orderNumber)) return "invalid" as const;
  const admin = createAdminClient();
  const { data: existing, error: loadError } = await table(admin).select("*").eq("tilopay_order_number", orderNumber).maybeSingle();
  if (loadError || !existing) return "missing" as const;
  const attempt = existing as Attempt;
  const id = attempt.storefront_domain_purchase_attempt_id as string;
  const { data: claimed, error: claimError } = await admin.schema("mediasis").rpc("claim_domain_purchase_reconciliation", { p_attempt_id: id });
  if (claimError) throw claimError;
  if (!claimed) return "processing" as const;
  let phase: "verification" | "registration" | "capture" = "verification";
  try {
    if (attempt.state === "registered") {
      if (attempt.billing_transaction_id) {
        try { const receipt = await issueCompletedDomainPurchaseReceipt(attempt.billing_transaction_id, admin); await update(admin, id, { receipt_retry_at: receipt.sent ? null : retryAt(300) }); }
        catch { await update(admin, id, { receipt_retry_at: retryAt(300) }); }
      }
      return "completed" as const;
    }

    if (attempt.state === "created" && Date.now() - new Date(attempt.created_at).getTime() < 15 * 60_000) return "pending" as const;
    const lifecycle = await consultTilopayLifecycle(orderNumber, attempt.total_minor, attempt.currency);
    const now = new Date().toISOString();
    if (attempt.state === "created" && !lifecycle.authorization && !lifecycle.capture) {
      await update(admin, id, { state: "failed", payment_failure_category: "checkout_expired", last_payment_verification_at: now, reconciliation_next_at: null });
      if (attempt.billing_transaction_id) await admin.schema("mediasis").from("business_billing_transactions")
        .update({ status: "failed" }).eq("billing_transaction_id", attempt.billing_transaction_id);
      return "expired" as const;
    }
    if (lifecycle.capture) {
      if (attempt.storefront_domain_id && !attempt.cloudflare_registration_reference && !attempt.simulated_registration) {
        // A completed workflow can omit its top-level domain_name. Recover the
        // registrar reference from the registered resource before closing out
        // an already captured purchase; never send another capture here.
        try {
          const registered = await getCloudflareRegisteredDomain(attempt.requested_domain);
          if (registered.status === "active" && registered.domain_name === attempt.requested_domain) {
            const { error: domainError } = await admin.schema("mediasis").from("storefront_domains")
              .update({ registrar_reference: registered.domain_name, expires_at: registered.expires_at ?? null })
              .eq("storefront_domain_id", attempt.storefront_domain_id).eq("business_id", attempt.business_id);
            if (domainError) throw domainError;
            await update(admin, id, { cloudflare_registration_reference: registered.domain_name });
            attempt.cloudflare_registration_reference = registered.domain_name;
          }
        } catch (error) {
          console.error("Registered domain reference requires reconciliation", { orderNumber, error });
        }
      }
      if (attempt.cloudflare_registration_reference && !attempt.simulated_registration) {
        try {
          const registration = await getCloudflareRegistrationStatus(attempt.requested_domain);
          if (!registration.completed || registration.state !== "succeeded") attempt.cloudflare_registration_reference = null;
        } catch {
          // Registrar API errors are inconclusive. Record the capture, but leave
          // fulfillment open for recovery or staff review.
          attempt.cloudflare_registration_reference = null;
        }
      }
      const captureReference = String(lifecycle.capture.id_tilopay ?? lifecycle.capture.tilopayTransaction ?? lifecycle.capture.orderNumber ?? "");
      const completed = await markCaptured(admin, attempt, captureReference);
      return completed ? "completed" as const : "attention" as const;
    }
    const authorization = lifecycle.authorization;
    const outcome = classifyTilopayTransaction(authorization);
    if (outcome.status === "declined") {
      await update(admin, id, { state: "failed", tilopay_response_code: String(authorization?.code ?? ""), payment_failure_category: outcome.failureCategory, last_payment_verification_at: now, reconciliation_next_at: null });
      if (attempt.billing_transaction_id) await admin.schema("mediasis").from("business_billing_transactions").update({ status: "failed", occurred_at: now }).eq("billing_transaction_id", attempt.billing_transaction_id);
      return "declined" as const;
    }
    if (outcome.status === "unknown") {
      if (attempt.failure_reason === "sdk_submission_failed" && Date.now() - new Date(attempt.created_at).getTime() > 30 * 60_000) {
        await update(admin, id, { state: "failed", payment_failure_category: "checkout_expired", last_payment_verification_at: now, reconciliation_next_at: null });
        if (attempt.billing_transaction_id) await admin.schema("mediasis").from("business_billing_transactions")
          .update({ status: "failed" }).eq("billing_transaction_id", attempt.billing_transaction_id);
        return "expired" as const;
      }
      await update(admin, id, { payment_failure_category: "verification_unknown", last_payment_verification_at: now, reconciliation_next_at: retryAt(20) });
      return "pending" as const;
    }
    if (attempt.payment_failure_category === "registration_failed") return "attention" as const;
    await update(admin, id, { state: attempt.state === "capture_failed" ? "capture_failed" : "authorized", tilopay_authorization_reference: authorization?.auth ?? attempt.tilopay_authorization_reference, tilopay_response_code: String(authorization?.code ?? ""), last_payment_verification_at: now, payment_failure_category: null, reconciliation_next_at: retryAt(20) });

    phase = "registration";
    if (attempt.simulated_registration) return "attention" as const;
    if (!attempt.storefront_domain_id) {
      let registration: CloudflareRegistration;
      if (attempt.registration_requested_at) {
        // An earlier request may have timed out after reaching the registrar.
        // Consult it; never submit an uncertain registration twice.
        registration = await getCloudflareRegistrationStatus(attempt.requested_domain);
      } else {
        const offer = await checkCloudflareDomain(attempt.requested_domain);
        if (offer.priceMinor !== attempt.cloudflare_price_minor || offer.currency !== attempt.currency) throw new Error("El precio del registrador cambió después de la autorización; se requiere revisión antes de registrar.");
        await update(admin, id, { state: "registering", registration_requested_at: now, reconciliation_next_at: retryAt(30) });
        attempt.registration_requested_at = now;
        registration = await registerCloudflareDomain(attempt.requested_domain);
      }
      if (!registration.completed || registration.state !== "succeeded") {
        await update(admin, id, { state: "registration_pending", cloudflare_workflow_url: registration.links?.self ?? null, payment_failure_category: "registration_pending", reconciliation_next_at: retryAt(60) });
        return "pending" as const;
      }
      const registered = await getCloudflareRegisteredDomain(attempt.requested_domain);
      if (registered.status !== "active" || registered.domain_name !== attempt.requested_domain) {
        await update(admin, id, { state: "registration_pending", payment_failure_category: "registration_pending", reconciliation_next_at: retryAt(60) });
        return "pending" as const;
      }
      const setup = await attachOrderingAppDomain(attempt.requested_domain);
      try { await ensurePurchasedDomainDns(attempt.requested_domain, setup.records); }
      catch (dnsError) {
        // DNS setup is recoverable. Do not leave an already registered domain
        // with an authorized hold solely because its DNS record write failed.
        console.error("Purchased domain DNS setup requires retry", { orderNumber, dnsError });
      }
      const httpsReady = setup.verified && setup.dnsConfigured && await storefrontHttpsReady(attempt.requested_domain);
      const { data: primary } = await admin.schema("mediasis").from("business_domain").select("business_domain_id").eq("business_uid", attempt.business_id).eq("type", "order_app").eq("is_internal_storefront", false).maybeSingle();
      const { data: domain, error: domainError } = await admin.schema("mediasis").from("storefront_domains")
        .upsert({ business_id: attempt.business_id, apex_domain: attempt.requested_domain, www_domain: setup.alias, source: "purchased", registrar: "cloudflare", registrar_reference: registered.domain_name, cloudflare_workflow_url: registration.links?.self ?? null, verification_status: httpsReady ? "active" : "vercel_pending", is_primary: !primary, expires_at: registered.expires_at ?? null, registered_at: now, dns_requirements: setup.records, verification_details: { managed_hostnames: setup.managedHostnames, dns_configured: setup.dnsConfigured, https_ready: httpsReady } }, { onConflict: "business_id,apex_domain" }).select("storefront_domain_id").single();
      if (domainError || !domain) throw domainError ?? new Error("No se pudo guardar el dominio.");
      await update(admin, id, { storefront_domain_id: domain.storefront_domain_id, cloudflare_registration_reference: registered.domain_name, cloudflare_workflow_url: registration.links?.self ?? null, state: "authorized", reconciliation_next_at: retryAt(20) });
      attempt.storefront_domain_id = domain.storefront_domain_id;
      attempt.cloudflare_registration_reference = registered.domain_name;
    }

    if (attempt.capture_requested_at) {
      phase = "capture";
      if (Date.now() - new Date(attempt.capture_requested_at).getTime() > 10 * 60_000) {
        await update(admin, id, { state: "capture_failed", payment_failure_category: "capture_failed", reconciliation_next_at: retryAt(300) });
        return "attention" as const;
      }
      return "pending" as const;
    }
    phase = "capture";
    await update(admin, id, { capture_requested_at: now, reconciliation_next_at: retryAt(20) });
    attempt.capture_requested_at = now;
    try {
      await captureTilopayAuthorization(orderNumber, (attempt.total_minor / 100).toFixed(2));
    } catch (error) {
      // A timeout or an unexpected modification response is not proof of failure.
      console.error("Domain capture requires consultation", { orderNumber, error });
    }
    const confirmed = await consultTilopayLifecycle(orderNumber, attempt.total_minor, attempt.currency);
    if (confirmed.capture) {
      await markCaptured(admin, attempt, String(confirmed.capture.id_tilopay ?? confirmed.capture.tilopayTransaction ?? confirmed.capture.orderNumber));
      return "completed" as const;
    }
    return "pending" as const;
  } catch (error) {
    console.error("Domain purchase reconciliation failed", { orderNumber, error });
    if (phase === "registration" && error instanceof CloudflareApiError && [400, 404, 422].includes(error.status) && !attempt.cloudflare_workflow_url) {
      // A rejected registration request has no workflow to poll. Preserve the
      // authorized hold for staff review instead of retrying a purchase blindly.
      await update(admin, id, { payment_failure_category: "registration_failed", failure_reason: error.message, reconciliation_next_at: null });
      return "attention" as const;
    }
    await update(admin, id, { reconciliation_next_at: retryAt(60), payment_failure_category: phase === "capture" ? "capture_failed" : phase === "registration" ? "registration_pending" : "verification_unknown" });
    return "pending" as const;
  } finally {
    await update(admin, id, { reconciliation_lease_until: null });
  }
}
