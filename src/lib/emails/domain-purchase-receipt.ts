import "server-only";

import { sendBrevoTransactionalEmail } from "@/lib/emails/brevo";

export type DomainPurchaseReceiptEmail = {
  receiptNumber: string;
  email: string;
  domain: string;
  amountMinor: number;
  currencyCode: string;
  paidAt: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character);
}

function receiptValues(receipt: DomainPurchaseReceiptEmail) {
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: receipt.currencyCode }).format(receipt.amountMinor / 100);
  const date = new Intl.DateTimeFormat("es-CR", { dateStyle: "long", timeZone: "America/Costa_Rica" }).format(new Date(receipt.paidAt));
  return { amount, date };
}

export function renderDomainPurchaseReceiptEmail(receipt: DomainPurchaseReceiptEmail) {
  const { amount, date } = receiptValues(receipt);
  const baseUrl = process.env.DASHBOARD_BASE_URL?.replace(/\/$/, "");
  const logoUrl = baseUrl ? `${baseUrl}/mediasis-logo.png` : "";
  const domain = escapeHtml(receipt.domain);
  const receiptNumber = escapeHtml(receipt.receiptNumber);
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="104" alt="Mediasis" style="display:block;height:auto;border:0;outline:none">`
    : `<span style="font:700 30px/1 Arial,sans-serif;letter-spacing:-1px;color:#ff6669">mediasis</span>`;
  const row = (label: string, value: string) => `<tr><td style="padding:14px 0;border-bottom:1px solid #e8edf5;color:#64748b;font:14px Arial,sans-serif">${label}</td><td style="padding:14px 0;border-bottom:1px solid #e8edf5;text-align:right;color:#0b1b3c;font:600 14px Arial,sans-serif">${value}</td></tr>`;
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7fb;padding:32px 16px;color:#0b1b3c"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08)"><tr><td style="padding:30px 36px 22px">${logo}</td></tr><tr><td style="padding:0 36px"><div style="height:1px;background:#e8edf5"></div></td></tr><tr><td style="padding:32px 36px 12px"><span style="display:inline-block;padding:7px 11px;border-radius:999px;background:#e8faf0;color:#087443;font:700 12px Arial,sans-serif">PAGO CONFIRMADO</span><h1 style="margin:20px 0 10px;font:700 28px/1.2 Arial,sans-serif;letter-spacing:-.5px">Tu dominio ya está comprado</h1><p style="margin:0;color:#64748b;font:16px/1.55 Arial,sans-serif">Confirmamos la compra de <strong style="color:#0b1b3c">${domain}</strong>. Guardá este comprobante para tus registros.</p></td></tr><tr><td style="padding:24px 36px 36px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e8edf5;border-radius:14px;padding:0 18px">${row("Dominio", domain)}${row("Fecha", escapeHtml(date))}${row("Comprobante", receiptNumber)}<tr><td style="padding:18px 0;color:#0b1b3c;font:700 16px Arial,sans-serif">Total cobrado</td><td style="padding:18px 0;text-align:right;color:#0b1b3c;font:700 20px Arial,sans-serif">${escapeHtml(amount)}</td></tr></table><p style="margin:24px 0 0;color:#64748b;font:13px/1.5 Arial,sans-serif">También podés consultar este comprobante en Configuración → Facturación.</p></td></tr><tr><td style="padding:22px 36px;background:#0b1b3c;color:#b9c5db;font:12px/1.5 Arial,sans-serif">mediasis<br>Este correo confirma un pago procesado. No incluye datos de tu tarjeta.</td></tr></table></td></tr></table></body></html>`;
}

export async function sendDomainPurchaseReceiptEmail(receipt: DomainPurchaseReceiptEmail) {
  return sendBrevoTransactionalEmail({
    senderName: "Mediasis",
    senderEmail: process.env.BREVO_SENDER_EMAIL?.trim() || "alejandrog@mediasis.cr",
    to: receipt.email,
    subject: `Comprobante de compra · ${receipt.domain}`,
    htmlContent: renderDomainPurchaseReceiptEmail(receipt),
    textContent: `Confirmamos la compra de ${receipt.domain}. Fecha: ${receiptValues(receipt).date}. Total cobrado: ${receiptValues(receipt).amount}. Comprobante: ${receipt.receiptNumber}.`,
  });
}
