import "server-only";

type CloudflareIssue = { code?: number; message?: string; source?: { pointer?: string } };
type CloudflareResult<T> = { success: boolean; result?: T; errors?: CloudflareIssue[] };

export class CloudflareApiError extends Error {
  constructor(message: string, readonly status: number, readonly issues: Array<{ code: number | null; pointer: string | null }> = []) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

function config() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) throw new Error("La compra de dominios todavía no está configurada. Agregá las credenciales de Cloudflare.");
  return { accountId, token };
}

async function request<T>(path: string, body: Record<string, unknown>) {
  const { accountId, token } = config();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/registrar/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null) as CloudflareResult<T> | null;
  if (!response.ok || !payload?.success) throw new CloudflareApiError(payload?.errors?.[0]?.message ?? "Cloudflare no pudo completar la solicitud.", response.status, (payload?.errors ?? []).map((issue) => ({ code: issue.code ?? null, pointer: issue.source?.pointer ?? null })));
  return payload.result as T;
}

async function get<T>(path: string) {
  const { accountId, token } = config();
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/registrar/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null) as CloudflareResult<T> | null;
  if (!response.ok || !payload?.success) throw new CloudflareApiError(payload?.errors?.[0]?.message ?? "Cloudflare no pudo consultar el registro.", response.status, (payload?.errors ?? []).map((issue) => ({ code: issue.code ?? null, pointer: issue.source?.pointer ?? null })));
  return payload.result as T;
}

export type CloudflareRegistration = { domain_name: string; state: string; completed: boolean; links?: { self?: string }; context?: { registration?: { expires_at?: string; status?: string } } };

/**
 * Starts an Mediasis-managed registration only after a card authorization has
 * been confirmed. Omitting contacts deliberately uses the Mediasis account's
 * default registrar contact; never expose that provider workflow to buyers.
 */
export async function registerCloudflareDomain(domain: string) {
  return request<CloudflareRegistration>("registrations", { domain_name: normalizedDomain(domain) });
}

export async function waitForCloudflareRegistration(domain: string, initial: CloudflareRegistration) {
  let registration = initial;
  for (let attempt = 0; !registration.completed && attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    registration = await get<CloudflareRegistration>(`registrations/${encodeURIComponent(domain)}/registration-status`);
  }
  return registration;
}

export async function getCloudflareRegistrationStatus(domain: string) {
  return get<CloudflareRegistration>(`registrations/${encodeURIComponent(domain)}/registration-status`);
}

export type CloudflareRegisteredDomain = { domain_name: string; status: string; expires_at?: string };

/** The registration resource supplies the domain name even when the workflow omits it. */
export async function getCloudflareRegisteredDomain(domain: string) {
  return get<CloudflareRegisteredDomain>(`registrations/${encodeURIComponent(domain)}`);
}


export type DomainOffer = { domain: string; available: boolean; priceMinor: number; currency: string; registrationYears: number };

function normalizedDomain(value: string) { return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, ""); }
function amountMinor(value: unknown) { const numeric = Number(value); return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0; }

export async function searchCloudflareDomains(query: string): Promise<DomainOffer[]> {
  const { accountId, token } = config();
  const params = new URLSearchParams({ q: normalizedDomain(query), limit: "10" });
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/registrar/domain-search?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null) as CloudflareResult<{ domains?: Array<Record<string, unknown>> }> | null;
  if (!response.ok || !payload?.success) throw new Error(payload?.errors?.[0]?.message ?? "Cloudflare no pudo buscar dominios.");
  return (payload.result?.domains ?? []).map((entry) => {
    const pricing = entry.pricing as Record<string, unknown> | undefined;
    return { domain: normalizedDomain(String(entry.name ?? entry.domain ?? "")), available: entry.registrable === true, priceMinor: amountMinor(pricing?.registration_cost), currency: String(pricing?.currency ?? "USD"), registrationYears: 1 };
  }).filter((entry) => entry.domain && entry.available && entry.currency === "USD" && entry.priceMinor > 0);
}

export async function checkCloudflareDomain(domain: string): Promise<DomainOffer> {
  const result = await request<Record<string, unknown>>("domain-check", { domains: [normalizedDomain(domain)] });
  const checked = (result as { domains?: Array<Record<string, unknown>> } | null)?.domains?.[0];
  const pricing = checked?.pricing as Record<string, unknown> | undefined;
  const offer = { domain: normalizedDomain(String(checked?.name ?? domain)), available: checked?.registrable === true, priceMinor: amountMinor(pricing?.registration_cost), currency: String(pricing?.currency ?? "USD"), registrationYears: 1 };
  if (!offer.available || offer.currency !== "USD" || offer.priceMinor <= 0) throw new Error("Ese dominio ya no está disponible con el precio mostrado.");
  return offer;
}
