import "server-only";

import { sendBrevoTransactionalEmail } from "@/lib/emails/brevo";

export type BusinessLifecycleEmail = {
  business_lifecycle_email_id: string;
  event_type: "trial_started" | "trial_payment_failed" | "renewal_payment_failed" | "cancellation_fee_failed";
  recipient_email: string;
  payload: Record<string, unknown>;
  brevo_idempotency_key: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function stringValue(payload: Record<string, unknown>, key: string, fallback: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function amountLabel(payload: Record<string, unknown>) {
  const amount = payload.amount_minor;
  const currency = stringValue(payload, "currency_code", "USD");
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "el precio acordado";
  return new Intl.NumberFormat("es-CR", { style: "currency", currency }).format(amount / 100);
}

function renderEmail(email: BusinessLifecycleEmail) {
  const payload = email.payload ?? {};
  const businessName = stringValue(payload, "business_name", "tu negocio");
  const baseUrl = process.env.DASHBOARD_BASE_URL?.replace(/\/$/, "") ?? "https://dashboard.mediasis.cr";
  const billingUrl = `${baseUrl}/admin/settings/billing`;
  const logoUrl = `${baseUrl}/mediasis-logo.png`;
  const isWelcome = email.event_type === "trial_started";
  const timezone = stringValue(payload, "timezone", "America/Costa_Rica");
  const endsAt = typeof payload.trial_ends_at === "string" ? new Date(payload.trial_ends_at) : null;
  const firstCharge = endsAt && !Number.isNaN(endsAt.getTime())
    ? new Intl.DateTimeFormat("es-CR", { dateStyle: "full", timeStyle: "short", timeZone: timezone }).format(endsAt)
    : "al terminar los 7 días de prueba";
  const graceEnd = typeof payload.grace_ends_at === "string" ? new Date(payload.grace_ends_at) : null;
  const graceDeadline = graceEnd && !Number.isNaN(graceEnd.getTime())
    ? new Intl.DateTimeFormat("es-CR", { dateStyle: "full", timeStyle: "short", timeZone: timezone }).format(graceEnd)
    : "dentro de los próximos 7 días";
  const cadence = stringValue(payload, "billing_cadence", "monthly") === "annual" ? "por año" : "por mes";
  const planName = stringValue(payload, "plan_name", "tu plan Mediasis");
  const content = isWelcome ? {
    subject: `Tu prueba gratis de Mediasis comenzó · ${businessName}`,
    badge: "PRUEBA GRATIS ACTIVA", badgeBackground: "#e8f1ff", badgeColor: "#0067ff",
    heading: "Gracias por elegir Mediasis",
    body: "Tenés los próximos 7 días para configurar tu negocio, probar cómo funciona Mediasis y dejar todo listo para recibir pedidos.",
    details: [["Negocio", businessName], ["Plan", planName], ["Primer cobro", `${amountLabel(payload)} ${cadence}`], ["Fecha de cobro", firstCharge]],
    footer: "No se realizó ningún cobro al iniciar tu prueba.", button: "Ir a mi panel",
  } : email.event_type === "renewal_payment_failed" ? {
    subject: `No pudimos cobrar la renovación de ${businessName}`,
    badge: "PAGO PENDIENTE", badgeBackground: "#fff0f1", badgeColor: "#c72a42",
    heading: "Tu pago de este período falló",
    body: "Conservás acceso durante el período de gracia. Revisá tu tarjeta y pagá antes de que termine para evitar una pausa en tu negocio.",
    details: [["Negocio", businessName], ["Pago pendiente", amountLabel(payload)], ["Fin del período de gracia", graceDeadline]],
    footer: "Podés pagar desde Facturación. No se realizará un segundo cobro por este mismo período si el pago se confirma.", button: "Pagar ahora",
  } : email.event_type === "cancellation_fee_failed" ? {
    subject: `Pago final pendiente · ${businessName}`,
    badge: "PAGO FINAL PENDIENTE", badgeBackground: "#fff0f1", badgeColor: "#c72a42",
    heading: "No pudimos cobrar el cargo final",
    body: "Tu suscripción terminó y el acceso sigue cerrado. El cargo final aceptado al contratar el plan mensual continúa pendiente.",
    details: [["Negocio", businessName], ["Saldo pendiente", amountLabel(payload)], ["Acceso", "La liquidación no reactiva la suscripción"]],
    footer: "Podés liquidar este saldo desde tu panel. No se harán reintentos automáticos.", button: "Revisar saldo",
  } : {
    subject: `No pudimos cobrar tu plan de Mediasis · ${businessName}`,
    badge: "ACCESO PAUSADO", badgeBackground: "#fff0f1", badgeColor: "#c72a42",
    heading: "Tu negocio fue pausado",
    body: "No pudimos completar el cobro al terminar tu prueba. El acceso al panel y a tu app de pedidos está pausado.",
    details: [["Negocio", businessName], ["Tus datos", "Siguen guardados"], ["Para reactivar", "Actualizá tu tarjeta en Facturación"]],
    footer: "Cuando el pago se confirme, restauraremos el acceso a tu negocio.", button: "Actualizar tarjeta",
  };
  const rows = content.details.map(([label, value], index) => `<tr><td style="padding:14px 0;${index < content.details.length - 1 ? "border-bottom:1px solid #e8edf5;" : ""}color:#64748b;font:14px Arial,sans-serif">${escapeHtml(label)}</td><td style="padding:14px 0;${index < content.details.length - 1 ? "border-bottom:1px solid #e8edf5;" : ""}text-align:right;color:#0b1b3c;font:600 14px Arial,sans-serif">${escapeHtml(value)}</td></tr>`).join("");
  return {
    subject: content.subject,
    htmlContent: `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7fb;padding:32px 16px;color:#0b1b3c"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08)"><tr><td style="padding:30px 36px 22px"><img src="${escapeHtml(logoUrl)}" width="104" alt="Mediasis" style="display:block;height:auto;border:0"></td></tr><tr><td style="padding:0 36px"><div style="height:1px;background:#e8edf5"></div></td></tr><tr><td style="padding:32px 36px 12px"><span style="display:inline-block;padding:7px 11px;border-radius:999px;background:${content.badgeBackground};color:${content.badgeColor};font:700 12px Arial,sans-serif;letter-spacing:.3px">${content.badge}</span><h1 style="margin:20px 0 10px;font:700 28px/1.2 Arial,sans-serif;letter-spacing:-.5px">${content.heading}</h1><p style="margin:0;color:#64748b;font:16px/1.55 Arial,sans-serif">Hola, ${escapeHtml(businessName)}. ${content.body}</p></td></tr><tr><td style="padding:24px 36px 36px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e8edf5;border-radius:14px;padding:0 18px">${rows}</table><a href="${escapeHtml(billingUrl)}" style="display:inline-block;margin:24px 0 0;padding:13px 20px;border-radius:10px;background:#0067ff;color:#ffffff;text-decoration:none;font:700 15px Arial,sans-serif">${content.button}</a></td></tr><tr><td style="padding:22px 36px;background:#0b1b3c;color:#b9c5db;font:12px/1.5 Arial,sans-serif">mediasis<br>${content.footer}</td></tr></table></td></tr></table></body></html>`,
    textContent: `Hola, ${businessName}. ${content.heading}. ${content.body} ${content.details.map(([label, value]) => `${label}: ${value}.`).join(" ")} ${billingUrl}`,
  };
}

export async function sendBusinessLifecycleEmail(email: BusinessLifecycleEmail) {
  const rendered = renderEmail(email);
  return sendBrevoTransactionalEmail({
    senderName: "Mediasis",
    senderEmail: process.env.BREVO_SENDER_EMAIL?.trim() || "alejandrog@mediasis.cr",
    to: email.recipient_email,
    ...rendered,
    idempotencyKey: email.brevo_idempotency_key,
  });
}
