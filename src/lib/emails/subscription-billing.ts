import "server-only";

import { sendBrevoTransactionalEmail } from "@/lib/emails/brevo";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

export async function sendSubscriptionBillingEmail(input: { to: string; businessName: string; event: "failed" | "recovered" | "suspended" | "plan_applied" | "plan_payment_failed" | "plan_scheduled"; idempotencyKey: string }) {
  const messages = {
    plan_applied: {
      subject: `Tu cambio de suscripción está activo para ${input.businessName}`,
      badge: "CAMBIO CONFIRMADO", badgeBackground: "#e8faf0", badgeColor: "#087443",
      heading: "Tu cambio de suscripción ya está activo",
      body: "Confirmamos el pago del cambio. Consultá el nuevo precio de renovación y tu comprobante en Facturación.",
      status: "Cambio activo", footer: "Este correo confirma un pago procesado. No incluye datos de tu tarjeta.",
    },
    plan_payment_failed: {
      subject: `No pudimos completar el cambio de plan de ${input.businessName}`,
      badge: "CAMBIO NO APLICADO", badgeBackground: "#fff4e8", badgeColor: "#b45309",
      heading: "Tu plan anterior sigue activo",
      body: "No se confirmó el pago del cambio. Podés revisar tu tarjeta y volver a intentarlo desde Facturación.",
      status: "Sin cambios", footer: "No activamos el nuevo plan ni alteramos tu periodo ya pagado.",
    },
    plan_scheduled: {
      subject: `Programamos un cambio de suscripción para ${input.businessName}`,
      badge: "CAMBIO PROGRAMADO", badgeBackground: "#e8f1ff", badgeColor: "#0067ff",
      heading: "Tu cambio está programado",
      body: "Tu plan actual sigue vigente hasta la renovación. Revisá el precio y la fecha del próximo cobro en Facturación.",
      status: "Pendiente de renovación", footer: "Este mensaje no confirma un nuevo pago.",
    },
    failed: {
      subject: `No pudimos renovar Mediasis para ${input.businessName}`,
      badge: "PAGO PENDIENTE",
      badgeBackground: "#fff4e8",
      badgeColor: "#b45309",
      heading: "No pudimos confirmar tu pago",
      body: "Intentaremos nuevamente. Revisá tu tarjeta o actualizá tu método de pago para mantener tu negocio activo.",
      status: "Pago pendiente",
      footer: "Te avisaremos si el cobro se confirma o si necesitás realizar alguna acción.",
    },
    recovered: {
      subject: "Tu pago de Mediasis fue confirmado",
      badge: "PAGO CONFIRMADO",
      badgeBackground: "#e8faf0",
      badgeColor: "#087443",
      heading: "Tu pago fue confirmado",
      body: "Tu negocio continúa activo. Podés consultar tu comprobante y la fecha del próximo cobro en Facturación.",
      status: "Suscripción activa",
      footer: "Este correo confirma un pago procesado. No incluye datos de tu tarjeta.",
    },
    suspended: {
      subject: "Tu negocio fue pausado por un pago pendiente",
      badge: "NEGOCIO PAUSADO",
      badgeBackground: "#fff0f1",
      badgeColor: "#c72a42",
      heading: "Tu negocio está pausado por un pago pendiente",
      body: "Tus datos y configuración siguen guardados. Actualizá tu tarjeta y realizá el pago para reactivar el panel y tu linkapp.",
      status: "Servicio pausado",
      footer: "Cuando el pago se confirme, restauraremos el acceso a tu negocio.",
    },
  }[input.event];
  const baseUrl = process.env.DASHBOARD_BASE_URL?.replace(/\/$/, "") ?? "https://dashboard.mediasis.cr";
  const billingUrl = `${baseUrl}/admin/settings/billing`;
  const logoUrl = `${baseUrl}/mediasis-logo.png`;
  const businessName = escapeHtml(input.businessName);
  const htmlContent = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7fb;padding:32px 16px;color:#0b1b3c"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08)"><tr><td style="padding:30px 36px 22px"><img src="${escapeHtml(logoUrl)}" width="104" alt="Mediasis" style="display:block;height:auto;border:0;outline:none"></td></tr><tr><td style="padding:0 36px"><div style="height:1px;background:#e8edf5"></div></td></tr><tr><td style="padding:32px 36px 12px"><span style="display:inline-block;padding:7px 11px;border-radius:999px;background:${messages.badgeBackground};color:${messages.badgeColor};font:700 12px Arial,sans-serif;letter-spacing:.3px">${messages.badge}</span><h1 style="margin:20px 0 10px;font:700 28px/1.2 Arial,sans-serif;letter-spacing:-.5px">${messages.heading}</h1><p style="margin:0;color:#64748b;font:16px/1.55 Arial,sans-serif">Hola, ${businessName}. ${messages.body}</p></td></tr><tr><td style="padding:24px 36px 36px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e8edf5;border-radius:14px;padding:0 18px"><tr><td style="padding:14px 0;border-bottom:1px solid #e8edf5;color:#64748b;font:14px Arial,sans-serif">Negocio</td><td style="padding:14px 0;border-bottom:1px solid #e8edf5;text-align:right;color:#0b1b3c;font:600 14px Arial,sans-serif">${businessName}</td></tr><tr><td style="padding:18px 0;color:#0b1b3c;font:700 16px Arial,sans-serif">Estado</td><td style="padding:18px 0;text-align:right;color:#0b1b3c;font:700 15px Arial,sans-serif">${messages.status}</td></tr></table><a href="${escapeHtml(billingUrl)}" style="display:inline-block;margin:24px 0 0;padding:13px 20px;border-radius:10px;background:#0067ff;color:#ffffff;text-decoration:none;font:700 15px Arial,sans-serif">Ir a Facturación</a><p style="margin:24px 0 0;color:#64748b;font:13px/1.5 Arial,sans-serif">¿Tenés preguntas? <a href="${escapeHtml(baseUrl)}/admin" style="color:#0067ff">Abrí el chat de Mediasis</a>.</p></td></tr><tr><td style="padding:22px 36px;background:#0b1b3c;color:#b9c5db;font:12px/1.5 Arial,sans-serif">mediasis<br>${messages.footer}</td></tr></table></td></tr></table></body></html>`;
  return sendBrevoTransactionalEmail({
    senderName: "Mediasis",
    senderEmail: process.env.BREVO_SENDER_EMAIL?.trim() || "alejandrog@mediasis.cr",
    to: input.to,
    subject: messages.subject,
    textContent: `Hola, ${input.businessName}. ${messages.heading}. ${messages.body} Estado: ${messages.status}. Facturación: ${billingUrl}`,
    htmlContent,
    idempotencyKey: input.idempotencyKey,
  });
}
