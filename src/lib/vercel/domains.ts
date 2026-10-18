import "server-only";

import { getDomain } from "tldts";

type VercelVerification = { type?: string; domain?: string; value?: string; reason?: string };
type VercelProjectDomain = { name?: string; verified?: boolean; verification?: VercelVerification[]; error?: { message?: string }; message?: string };
type VercelRecommendation = string | { rank?: number; value?: string | string[] };
type VercelDomainConfig = { misconfigured?: boolean; recommendedCNAME?: VercelRecommendation | VercelRecommendation[]; recommendedIPv4?: VercelRecommendation | VercelRecommendation[]; error?: { message?: string }; message?: string };

export type DomainDnsRecord = { provider: "Vercel"; type: string; host: string; hostname: string; zone: string; value: string; purpose: string };
export type OrderingDomainSetup = { hostname: string; alias: string | null; managedHostnames: string[]; verified: boolean; dnsConfigured: boolean; records: DomainDnsRecord[] };

function config() {
  const token = process.env.VERCEL_TOKEN?.trim();
  const projectId = process.env.ORDER_APP_VERCEL_PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (!token || !projectId) throw new Error("La conexión de dominios todavía no está configurada.");
  return { token, projectId, teamId };
}
function query() { const { teamId } = config(); return teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""; }
function projectUrl(path: string) { const { projectId } = config(); return `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${path}${query()}`; }
function domainConfigUrl(domain: string) { return `https://api.vercel.com/v6/domains/${encodeURIComponent(domain)}/config${query()}`; }

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const { token } = config();
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null) as (T & { error?: { message?: string }; message?: string }) | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? "No se pudo preparar el dominio.");
  return (payload ?? {}) as T;
}

function dnsZone(hostname: string) { return getDomain(hostname, { allowPrivateDomains: false }) ?? hostname; }
function relativeHost(hostname: string, zone: string) { const normalized = hostname.replace(/\.$/, "").toLowerCase(); return normalized === zone ? "@" : normalized.endsWith(`.${zone}`) ? normalized.slice(0, -(zone.length + 1)) : normalized; }
function isApexDomain(hostname: string) { return hostname === dnsZone(hostname); }

function verificationRecords(details: VercelProjectDomain): DomainDnsRecord[] {
  return (details.verification ?? []).flatMap((record) => {
    if (!record.type || !record.domain || !record.value) return [];
    const zone = dnsZone(record.domain);
    return [{ provider: "Vercel" as const, type: record.type, host: relativeHost(record.domain, zone), hostname: record.domain.replace(/\.$/, ""), zone, value: record.value, purpose: record.reason ?? "Verificar que administrás este dominio" }];
  });
}
function recommendationValues(recommendation: VercelDomainConfig["recommendedCNAME"]): string[] {
  const entries = (Array.isArray(recommendation) ? recommendation : [recommendation]).filter(Boolean) as VercelRecommendation[];
  const first = entries.sort((left, right) => (typeof left === "object" ? left.rank ?? 99 : 99) - (typeof right === "object" ? right.rank ?? 99 : 99))[0];
  if (typeof first === "string") return [first];
  if (!first?.value) return [];
  return Array.isArray(first.value) ? first.value : [first.value];
}
function routingRecords(hostname: string, details: VercelDomainConfig): DomainDnsRecord[] {
  const zone = dnsZone(hostname);
  const apex = isApexDomain(hostname);
  const values = recommendationValues(apex ? details.recommendedIPv4 : details.recommendedCNAME);
  const type = apex ? "A" : "CNAME";
  return values.map((value) => ({ provider: "Vercel" as const, type, host: relativeHost(hostname, zone), hostname, zone, value, purpose: "Dirigir la app de pedidos" }));
}

async function ensureProjectHostname(hostname: string) {
  try { await request<VercelProjectDomain>(projectUrl("/domains"), { method: "POST", body: JSON.stringify({ name: hostname }) }); }
  catch (error) { if (!(error instanceof Error) || !/already|exists|assigned/i.test(error.message)) throw error; }
  return request<VercelProjectDomain>(projectUrl(`/domains/${encodeURIComponent(hostname)}`), { method: "GET" });
}
async function redirectProjectHostname(hostname: string, destination: string) {
  await request<VercelProjectDomain>(projectUrl(`/domains/${encodeURIComponent(hostname)}`), { method: "PATCH", body: JSON.stringify({ redirect: destination, redirectStatusCode: 308 }) });
}
async function refreshProjectHostname(hostname: string) {
  const initial = await ensureProjectHostname(hostname);
  if (initial.verified) return initial;
  try { await request<VercelProjectDomain>(projectUrl(`/domains/${encodeURIComponent(hostname)}/verify`), { method: "POST" }); } catch { /* GET returns the current challenge. */ }
  return request<VercelProjectDomain>(projectUrl(`/domains/${encodeURIComponent(hostname)}`), { method: "GET" });
}
async function hostnameSetup(hostname: string) {
  const details = await refreshProjectHostname(hostname);
  const dns = await request<VercelDomainConfig>(domainConfigUrl(hostname), { method: "GET" });
  const routes = routingRecords(hostname, dns);
  const records = [...verificationRecords(details), ...routes];
  if (!routes.length && dns.misconfigured) throw new Error("No pudimos obtener el registro DNS exacto para dirigir el dominio. Intentá preparar el dominio nuevamente.");
  if (!records.length && !details.verified) throw new Error("No pudimos obtener los registros DNS exactos. Intentá preparar el dominio nuevamente.");
  if (dns.misconfigured === undefined) throw new Error("No pudimos comprobar la configuración DNS del dominio. Intentá nuevamente.");
  return { verified: details.verified === true, dnsConfigured: dns.misconfigured === false, records };
}

/** Attach exactly the requested hostname. Only registrable domains receive a www alias. */
export async function attachOrderingAppDomain(hostname: string): Promise<OrderingDomainSetup> {
  const alias = isApexDomain(hostname) ? `www.${hostname}` : null;
  const primary = await hostnameSetup(hostname);
  const aliasSetup = alias ? await hostnameSetup(alias) : null;
  if (alias) await redirectProjectHostname(alias, hostname);
  return { hostname, alias, managedHostnames: [hostname, ...(alias ? [alias] : [])], verified: primary.verified && (aliasSetup?.verified ?? true), dnsConfigured: primary.dnsConfigured && (aliasSetup?.dnsConfigured ?? true), records: [...primary.records, ...(aliasSetup?.records ?? [])] };
}

/** Removes only hostnames that Mediasis previously recorded as managed. */
export async function detachOrderingAppDomains(hostnames: string[]) {
  // Vercel will not remove a redirect destination until redirecting aliases
  // are gone, so remove deeper hostnames (www.example.com) first.
  for (const hostname of [...hostnames].sort((left, right) => right.split(".").length - left.split(".").length)) {
    try { await request<Record<string, never>>(projectUrl(`/domains/${encodeURIComponent(hostname)}`), { method: "DELETE" }); }
    catch (error) {
      if (!(error instanceof Error) || !/not found|does not exist/i.test(error.message)) throw error;
    }
  }
}
export function storefrontDnsZone(hostname: string) { return dnsZone(hostname); }
