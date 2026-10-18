'use server';

type SendBrevoEmailInput = {
  senderName: string;
  senderEmail: string;
  /** single email or list of emails */
  to: string | string[];
  /** Brevo template ID */
  templateId: number;
  /** JSON payload for template params (depends on the template) */
  params?: Record<string, unknown>;
};

type SendBrevoEmailResult = {
  success: boolean;
  message: string;
  messageId?: string;
};

type SendBrevoTransactionalEmailInput = {
  senderName: string;
  senderEmail: string;
  to: string | string[];
  subject: string;
  htmlContent: string;
  textContent: string;
  idempotencyKey?: string;
};

interface BrevoResponse {
  messageId?: string;
  message?: string;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export async function sendBrevoEmail({
  senderName,
  senderEmail,
  to,
  templateId,
  params = {},
}: SendBrevoEmailInput): Promise<SendBrevoEmailResult> {
  try {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        message: 'BREVO_API_KEY is not set in environment variables.',
      };
    }

    // Normalize "to" into Brevo's expected shape
    const toArray =
      typeof to === 'string'
        ? [{ email: to }]
        : to.map((email) => ({ email }));

    // Basic input checks (optional but helpful)
    if (!senderName?.trim()) {
      return { success: false, message: 'senderName is required.' };
    }
    if (!senderEmail?.trim()) {
      return { success: false, message: 'senderEmail is required.' };
    }
    if (!toArray.length) {
      return { success: false, message: 'At least one recipient email is required.' };
    }
    if (!Number.isFinite(templateId)) {
      return { success: false, message: 'templateId must be a number.' };
    }

    // Optional: abort after 15s
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: toArray,
        templateId,
        // Brevo will ignore "params" if template doesn't use them
        params,
      }),
      signal: controller.signal,
      // Next.js note: no-cache is fine for actions; not strictly required here
      cache: 'no-store',
    });

    clearTimeout(timeout);

    const text = await res.text();
    let json: BrevoResponse | undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // leave as text if not JSON
    }

    if (!res.ok) {
      // Brevo typically returns an error JSON with message/details
      const reason =
        (json && (json.message || json.error || JSON.stringify(json))) ||
        text ||
        `HTTP ${res.status}`;
      return { success: false, message: reason };
    }

    // Success: Brevo usually returns { messageId: '...' }
    const msg =
      (json && (json.messageId || json.message || JSON.stringify(json))) ||
      'Email sent successfully.';
    return { success: true, message: String(msg), messageId: json?.messageId };
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    const message =
      err instanceof Error
        ? err.message
        : aborted
        ? 'Request timed out.'
        : 'Unknown error';

    return {
      success: false,
      message,
    };
  }
}

/** Sends a self-contained transactional message. Use this for receipts whose
 * layout is owned in the product rather than in a Brevo dashboard template. */
export async function sendBrevoTransactionalEmail({
  senderName,
  senderEmail,
  to,
  subject,
  htmlContent,
  textContent,
  idempotencyKey,
}: SendBrevoTransactionalEmailInput): Promise<SendBrevoEmailResult> {
  try {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return { success: false, message: "BREVO_API_KEY is not set in environment variables." };
    const recipients = (typeof to === "string" ? [to] : to)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
      .map((email) => ({ email }));
    if (!senderName.trim() || !senderEmail.trim() || !subject.trim() || !htmlContent.trim() || !recipients.length) {
      return { success: false, message: "Faltan los datos requeridos para enviar el correo." };
    }
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": apiKey },
      body: JSON.stringify({ sender: { name: senderName, email: senderEmail }, to: recipients, subject, htmlContent, textContent,
        ...(idempotencyKey ? { headers: { idempotencyKey } } : {}) }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const body = await response.text();
    const payload = (() => { try { return body ? JSON.parse(body) as BrevoResponse : undefined; } catch { return undefined; } })();
    if (!response.ok) {
      // Brevo returns this after a previously accepted request with the same
      // key. Treat it as delivered so a retry cannot send a second message.
      if (idempotencyKey && payload?.code === "duplicate_parameter") {
        return { success: true, message: "Correo aceptado previamente por Brevo." };
      }
      return { success: false, message: (payload?.message ?? payload?.error ?? body) || `HTTP ${response.status}` };
    }
    return { success: true, message: "Correo enviado.", messageId: payload?.messageId };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "No se pudo enviar el correo." };
  }
}
