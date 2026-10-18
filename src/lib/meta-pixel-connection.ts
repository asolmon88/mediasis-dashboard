import "server-only";

import crypto from "node:crypto";

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v26.0";
const STATE_TTL_MS = 10 * 60 * 1000;
// Merchant-owned connections use Meta's Business On Behalf Of endpoint.
// Mediasis-owned Pixels use Mediasis's existing permanent system-user credential.
const CAPI_SENDING_SCOPES = ["ads_management"];

export type MetaConnectionStage = "configuration" | "exchange" | "pixel-access" | "obo-relationship" | "system-user" | "asset-assignment" | "credential" | "validation";
export type MetaFailureCategory = "pixel-access" | "assignment-permission" | "authorization-invalid" | "temporary" | "configuration" | "unknown";
export type MetaErrorDetails = { code?: number; subcode?: number; transient?: boolean; traceId?: string };

class MetaGraphError extends Error {
  constructor(message: string, public readonly details: MetaErrorDetails) { super(message); }
}

export class MetaConnectionError extends Error {
  public readonly details: MetaErrorDetails | undefined;

  constructor(public readonly stage: MetaConnectionStage, cause: unknown) {
    super(cause instanceof Error ? cause.message : "Meta rechazó la solicitud.");
    this.details = cause instanceof MetaGraphError ? cause.details : cause instanceof MetaConnectionError ? cause.details : undefined;
  }
}
async function atStage<T>(stage: MetaConnectionStage, operation: () => Promise<T>) {
  try { return await operation(); } catch (error) {
    if (error instanceof MetaConnectionError) throw error;
    throw new MetaConnectionError(stage, error);
  }
}

export type MetaOAuthState = { nonce: string; businessId: string; actorId: string; pixelId: string; expiresAt: number };

type MetaConfig = { appId: string; appSecret: string; baseUrl: string; scopes: string[]; partnerBusinessId: string; partnerSystemUserToken: string };

export function metaConfigurationIssue() {
  const required = ["META_APP_ID", "META_APP_SECRET", "META_OAUTH_STATE_SECRET", "DASHBOARD_BASE_URL", "META_PARTNER_BUSINESS_ID", "META_PARTNER_SYSTEM_USER_TOKEN"] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) return `Faltan: ${missing.join(", ")}.`;
  try {
    if (new URL(process.env.DASHBOARD_BASE_URL!).protocol !== "https:") return "DASHBOARD_BASE_URL debe usar HTTPS.";
  } catch { return "DASHBOARD_BASE_URL no es una URL válida."; }
  return null;
}

function config(): MetaConfig {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const baseUrl = process.env.DASHBOARD_BASE_URL;
  const partnerBusinessId = process.env.META_PARTNER_BUSINESS_ID;
  const partnerSystemUserToken = process.env.META_PARTNER_SYSTEM_USER_TOKEN;
  if (!appId || !appSecret || !baseUrl || !partnerBusinessId || !partnerSystemUserToken) throw new Error(metaConfigurationIssue() || "Meta connection is not configured.");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:") throw new Error("DASHBOARD_BASE_URL must use HTTPS.");
  return { appId, appSecret, baseUrl: parsed.origin, partnerBusinessId, partnerSystemUserToken, scopes: (process.env.META_OAUTH_SCOPES || "business_management,ads_management").split(",").map((value) => value.trim()).filter(Boolean) };
}

export function callbackUrl() { return new URL("/api/meta/callback", config().baseUrl).toString(); }
export function validatePixelId(value: string | null) {
  const pixelId = value?.trim() || "";
  if (!/^\d{5,30}$/.test(pixelId)) throw new Error("Ingresá un ID de pixel válido.");
  return pixelId;
}

export function createState(businessId: string, actorId: string, pixelId: string): MetaOAuthState {
  return { nonce: crypto.randomBytes(32).toString("base64url"), businessId, actorId, pixelId, expiresAt: Date.now() + STATE_TTL_MS };
}

function stateKey() {
  const configured = process.env.META_OAUTH_STATE_SECRET;
  if (!configured) throw new Error("META_OAUTH_STATE_SECRET is missing.");
  return configured;
}

export function sealState(state: MetaOAuthState) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = crypto.createHmac("sha256", stateKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function unsealState(value: string | undefined): MetaOAuthState | null {
  if (!value) return null;
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length) return null;
  const expected = crypto.createHmac("sha256", stateKey()).update(payload).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MetaOAuthState;
    if (!parsed.nonce || !parsed.businessId || !parsed.pixelId || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch { return null; }
}

export function authorizationUrl(state: MetaOAuthState) {
  const cfg = config();
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("redirect_uri", callbackUrl());
  url.searchParams.set("state", state.nonce);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scopes.join(","));
  return url.toString();
}

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string; is_transient?: boolean; error_user_title?: string; error_user_msg?: string } };
async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}${path}`, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & GraphError;
  if (!response.ok || body.error) {
    const message = body.error?.message || "Meta rechazó la solicitud.";
    const secrets = [
      ...new URLSearchParams(path.split("?")[1] ?? ""),
      ...new URLSearchParams(typeof init.body === "string" ? init.body : ""),
    ].filter(([key]) => ["access_token", "input_token", "client_secret", "code", "appsecret_proof"].includes(key)).map(([, value]) => value).filter(Boolean);
    const redact = (text: string | undefined) => secrets.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), text || "");
    const safeMessage = redact(message);
    throw new MetaGraphError(`${safeMessage} (endpoint ${init.method || "GET"} ${path.split("?")[0]}, code ${body.error?.code ?? response.status}${body.error?.error_subcode ? `, subcode ${body.error.error_subcode}` : ""}${body.error?.fbtrace_id ? `, trace ${body.error.fbtrace_id}` : ""})`, {
      code: body.error?.code ?? response.status,
      subcode: body.error?.error_subcode,
      transient: body.error?.is_transient,
      traceId: body.error?.fbtrace_id,
    });
  }
  return body;
}

export function metaFailureCategory(error: unknown): MetaFailureCategory {
  if (!(error instanceof MetaConnectionError)) return "unknown";
  const { code, transient } = error.details ?? {};
  if (transient || code === 4 || code === 17 || code === 32 || code === 341 || code === 613 || code === 429) return "temporary";
  if (code === 190) return "authorization-invalid";
  if (error.stage === "pixel-access") return "pixel-access";
  if ((code === 10 || code === 200) && error.stage === "asset-assignment") return "assignment-permission";
  if (error.stage === "configuration" || error.stage === "credential" || error.stage === "system-user" || error.stage === "validation") return "configuration";
  return "unknown";
}
function appSecretProof(token: string) { return crypto.createHmac("sha256", config().appSecret).update(token).digest("hex"); }
function params(values: Record<string, string>) { return new URLSearchParams(values).toString(); }

async function graphList<T>(path: string, values: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const query = params({ ...values, limit: "100", ...(after ? { after } : {}) });
    const result = await graph<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${path}?${query}`);
    items.push(...(result.data ?? []));
    if (!result.paging?.next || !result.paging.cursors?.after) return items;
    after = result.paging.cursors.after;
  }
  throw new Error("Meta devolvió demasiadas páginas de resultados.");
}

export async function exchangeCode(code: string) {
  const cfg = config();
  const data = await atStage("exchange", () => graph<{ access_token?: string }>(`/oauth/access_token?${params({ client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: callbackUrl(), code })}`));
  if (!data.access_token) throw new Error("Meta no devolvió un token de autorización.");
  return data.access_token;
}

async function getOwnedPixelBusiness(userToken: string, pixelId: string) {
  const proof = appSecretProof(userToken);
  const businesses = await atStage("pixel-access", () => graphList<{ id?: string }>("/me/businesses", { fields: "id", access_token: userToken, appsecret_proof: proof }));
  for (const business of businesses) {
    if (!business.id) continue;
    const pixels = await atStage("pixel-access", () => graphList<{ id?: string }>(`/${business.id}/owned_pixels`, { fields: "id", access_token: userToken, appsecret_proof: proof }));
    if (pixels.some((pixel) => pixel.id === pixelId)) return business.id;
  }
  throw new Error("No tenés acceso de administrador al pixel indicado desde esta cuenta de Meta.");
}

async function verifyAppOwner(cfg: MetaConfig) {
  const adminToken = cfg.partnerSystemUserToken;
  const apps = await atStage("configuration", () => graphList<{ id?: string }>(`/${cfg.partnerBusinessId}/owned_apps`, {
    fields: "id", access_token: adminToken, appsecret_proof: appSecretProof(adminToken),
  }));
  if (!apps.some((app) => app.id === cfg.appId)) {
    throw new MetaConnectionError("configuration", new Error("El portafolio de Mediasis configurado no aparece como propietario de la aplicación Meta."));
  }
}

async function assignPixel(pixelId: string, systemUserId: string, token: string) {
  await atStage("asset-assignment", () => graph(`/${pixelId}/assigned_users`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    // AdsPixel's POST assigned_users reference accepts user and tasks. Pixel
    // tasks support EDIT; MANAGE is for page/catalog assets and Meta rejects it.
    body: params({ user: systemUserId, tasks: '["EDIT"]', access_token: token, appsecret_proof: appSecretProof(token) }),
  }));
}

async function createSameBusinessCredential(cfg: MetaConfig) {
  const adminToken = cfg.partnerSystemUserToken;
  const proof = appSecretProof(adminToken);
  const systemUser = await atStage("system-user", () => graph<{ id?: string }>(`/me?${params({ fields: "id", access_token: adminToken, appsecret_proof: proof })}`));
  if (!systemUser.id) throw new MetaConnectionError("system-user", new Error("Meta no identificó el usuario del sistema de Mediasis."));
  return { accessToken: adminToken, systemUserId: systemUser.id };
}

async function createMerchantCredential(cfg: MetaConfig, businessId: string, pixelId: string, userToken: string) {
  const adminToken = cfg.partnerSystemUserToken;
  const proof = appSecretProof(adminToken);
  // Meta's Business On Behalf Of flow requires this relationship before the
  // partner system user can request the merchant business's system-user token.
  // Do not try to read `managed_businesses`: Meta exposes this edge for POST,
  // not GET. The merchant admin's OAuth token authorizes this relationship.
  await atStage("obo-relationship", () => graph(`/${cfg.partnerBusinessId}/managed_businesses`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params({ existing_client_business_id: businessId, access_token: userToken, appsecret_proof: appSecretProof(userToken) }),
  }));
  const issued = await atStage("credential", () => graph<{ access_token?: string }>(`/${businessId}/access_token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params({ app_id: cfg.appId, scope: CAPI_SENDING_SCOPES.join(","), access_token: adminToken, appsecret_proof: proof }),
  }));
  if (!issued.access_token) throw new MetaConnectionError("credential", new Error("Meta no emitió la credencial del comercio."));
  const accessToken = issued.access_token;
  const systemUser = await atStage("system-user", () => graph<{ id?: string }>(`/me?${params({ access_token: accessToken, appsecret_proof: appSecretProof(accessToken) })}`));
  if (!systemUser.id) throw new MetaConnectionError("system-user", new Error("Meta no devolvió el usuario del sistema del comercio."));
  await assignPixel(pixelId, systemUser.id, userToken);
  return { accessToken, systemUserId: systemUser.id };
}

async function validateSendingCredential(cfg: MetaConfig, pixelId: string, accessToken: string) {
  const debug = await atStage("validation", () => graph<{ data?: { app_id?: string; type?: string; is_valid?: boolean; expires_at?: number } }>(`/debug_token?${params({ input_token: accessToken, access_token: `${cfg.appId}|${cfg.appSecret}` })}`));
  if (!debug.data?.is_valid || String(debug.data.app_id) !== cfg.appId || debug.data.type !== "SYSTEM_USER" || debug.data.expires_at !== 0) {
    throw new MetaConnectionError("validation", new Error("La credencial de Meta no es un token permanente de usuario del sistema de esta aplicación."));
  }
  const pixel = await atStage("validation", () => graph<{ id?: string }>(`/${pixelId}?${params({ fields: "id", access_token: accessToken, appsecret_proof: appSecretProof(accessToken) })}`));
  if (pixel.id !== pixelId) throw new MetaConnectionError("validation", new Error("La credencial no tiene acceso al pixel seleccionado."));
}

/** The OAuth user token authorizes discovery and merchant consent; only a validated system-user token is returned. */
export async function createSendingCredential(userToken: string, pixelId: string) {
  const cfg = config();
  await verifyAppOwner(cfg);
  const metaBusinessId = await getOwnedPixelBusiness(userToken, pixelId);
  const credential = metaBusinessId === cfg.partnerBusinessId
    ? await createSameBusinessCredential(cfg)
    : await createMerchantCredential(cfg, metaBusinessId, pixelId, userToken);
  await validateSendingCredential(cfg, pixelId, credential.accessToken);
  return { ...credential, metaBusinessId };
}
