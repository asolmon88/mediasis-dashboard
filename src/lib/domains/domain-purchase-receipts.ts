import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendDomainPurchaseReceiptEmail } from "@/lib/emails/domain-purchase-receipt";

type PaidDomainTransaction = {
  billing_transaction_id: string;
  business_id: string;
  amount_minor: number;
  currency_code: string;
  occurred_at: string | null;
  created_at: string;
};

/**
 * Issues the immutable receipt and sends its email after a payment processor
 * has captured the charge and the registrar has confirmed the domain. This is
 * deliberately not callable from the checkout browser.
 */
export async function issueCompletedDomainPurchaseReceipt(billingTransactionId: string, admin = createAdminClient()) {
  const { data: transaction, error: transactionError } = await admin.schema("mediasis").from("business_billing_transactions")
    .select("billing_transaction_id,business_id,amount_minor,currency_code,occurred_at,created_at,status,charge_type")
    .eq("billing_transaction_id", billingTransactionId)
    .maybeSingle();
  if (transactionError || !transaction) throw new Error("No se encontró la transacción de dominio.");
  if (transaction.charge_type !== "domain_purchase" || transaction.status !== "paid") throw new Error("El comprobante solo puede emitirse para una compra de dominio pagada.");

  const { data: attempt, error: attemptError } = await admin.schema("mediasis").from("storefront_domain_purchase_attempts")
    .select("requested_domain,customer_contact,registrant_contact,state,total_minor,currency,tilopay_capture_reference")
    .eq("billing_transaction_id", billingTransactionId)
    .maybeSingle();
  if (attemptError || !attempt || attempt.state !== "registered") throw new Error("El dominio todavía no fue registrado.");
  if (!attempt.tilopay_capture_reference || Number(attempt.total_minor) !== Number(transaction.amount_minor)
    || attempt.currency !== transaction.currency_code) {
    throw new Error("El monto capturado no coincide con la compra guardada. Requiere revisión antes de emitir el comprobante.");
  }
  const contact = (attempt.customer_contact ?? attempt.registrant_contact) as { email?: unknown } | null;
  const email = typeof contact?.email === "string" ? contact.email.trim().toLowerCase() : "";
  if (!email) throw new Error("La compra no contiene un correo para el comprobante.");

  const paidAt = transaction.occurred_at ?? transaction.created_at;
  const receiptNumber = `DOM-${billingTransactionId.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const { data: receipt, error: receiptError } = await admin.schema("mediasis").from("business_billing_receipts")
    .upsert({ business_id: transaction.business_id, billing_transaction_id: billingTransactionId, receipt_number: receiptNumber, receipt_email: email, purchased_domain: attempt.requested_domain, amount_minor: transaction.amount_minor, currency_code: transaction.currency_code, paid_at: paidAt }, { onConflict: "billing_transaction_id", ignoreDuplicates: true })
    .select("billing_receipt_id,receipt_number,receipt_email,purchased_domain,amount_minor,currency_code,paid_at,email_delivery_status")
    .maybeSingle();
  if (receiptError) throw new Error("No se pudo guardar el comprobante.");
  const resolved = receipt ?? (await admin.schema("mediasis").from("business_billing_receipts").select("billing_receipt_id,receipt_number,receipt_email,purchased_domain,amount_minor,currency_code,paid_at,email_delivery_status").eq("billing_transaction_id", billingTransactionId).single()).data;
  if (!resolved) throw new Error("No se pudo recuperar el comprobante.");
  if (Number(resolved.amount_minor) !== Number(attempt.total_minor) || resolved.currency_code !== attempt.currency) {
    throw new Error("El comprobante anterior no coincide con el monto capturado. Requiere revisión.");
  }
  if (resolved.email_delivery_status === "sent") return { receiptId: resolved.billing_receipt_id, sent: true, alreadySent: true };

  const delivery = await sendDomainPurchaseReceiptEmail({ receiptNumber: resolved.receipt_number, email: resolved.receipt_email, domain: resolved.purchased_domain, amountMinor: resolved.amount_minor, currencyCode: resolved.currency_code, paidAt: resolved.paid_at });
  await admin.schema("mediasis").from("business_billing_receipts").update({ email_delivery_status: delivery.success ? "sent" : "failed", email_provider_message_id: delivery.messageId ?? null, email_sent_at: delivery.success ? new Date().toISOString() : null, email_delivery_error: delivery.success ? null : delivery.message }).eq("billing_receipt_id", resolved.billing_receipt_id);
  return { receiptId: resolved.billing_receipt_id, sent: delivery.success, alreadySent: false };
}
