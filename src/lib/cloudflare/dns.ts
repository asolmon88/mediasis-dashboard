import "server-only";

import type { DomainDnsRecord } from "@/lib/vercel/domains";

type ApiResult<T> = { success: boolean; result: T; errors?: Array<{ message?: string }> };
type Zone = { id: string; name: string; account?: { id?: string } };
type DnsRecord = { type: string; name: string; content: string; proxied?: boolean };

async function cloudflare<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) throw new Error("Falta la configuración DNS de Cloudflare.");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as ApiResult<T> | null;
  if (!response.ok || !payload?.success) throw new Error(payload?.errors?.[0]?.message ?? "Cloudflare no pudo configurar los registros DNS.");
  return payload.result;
}

/** Create only Vercel's exact records in a zone owned by this Cloudflare account. */
export async function ensurePurchasedDomainDns(domain: string, requirements: DomainDnsRecord[]) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!accountId) throw new Error("Falta la cuenta DNS de Cloudflare.");
  const zones = await cloudflare<Zone[]>(`/zones?name=${encodeURIComponent(domain)}&account.id=${encodeURIComponent(accountId)}`);
  const zone = zones.find((entry) => entry.name === domain && entry.account?.id === accountId);
  if (!zone) throw new Error("No se encontró la zona DNS del dominio comprado en Cloudflare.");
  const records = await cloudflare<DnsRecord[]>(`/zones/${zone.id}/dns_records?per_page=100`);
  for (const requirement of requirements) {
    if (requirement.zone !== domain || !["A", "AAAA", "CNAME", "TXT"].includes(requirement.type)) continue;
    const name = requirement.hostname.toLowerCase().replace(/\.$/, "");
    if (name !== domain && !name.endsWith(`.${domain}`)) throw new Error("El registro DNS está fuera del dominio comprado.");
    const content = requirement.value.replace(/\.$/, "");
    const existing = records.find((record) => record.type === requirement.type && record.name === name && record.content.replace(/\.$/, "") === content);
    if (existing) {
      if (requirement.type !== "TXT" && existing.proxied) throw new Error(`Desactivá el proxy de Cloudflare para ${name} antes de verificar el dominio.`);
      continue;
    }
    const conflict = records.find((record) => record.name === name && (
      requirement.type === "CNAME" ? ["A", "AAAA", "CNAME"].includes(record.type) :
      ["A", "AAAA"].includes(requirement.type) && record.type === "CNAME"
    ));
    if (conflict) throw new Error(`Hay un registro ${conflict.type} incompatible en ${name}. Revisá el DNS antes de continuar.`);
    const created = await cloudflare<DnsRecord>(`/zones/${zone.id}/dns_records`, {
      method: "POST", body: JSON.stringify({ type: requirement.type, name, content, ttl: 1, proxied: false }),
    });
    records.push(created);
  }
}
