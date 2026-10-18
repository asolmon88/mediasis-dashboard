import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const pixelId = "1465410088761576";
const source = fs.readFileSync(path.join(import.meta.dirname, "../src/lib/meta-pixel-connection.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const callbackSource = fs.readFileSync(path.join(import.meta.dirname, "../src/app/api/meta/callback/route.ts"), "utf8");
const callbackCompiled = ts.transpileModule(callbackSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

function harness(ownerId, overrides = {}) {
  const calls = [];
  const env = {
    META_APP_ID: "200",
    META_APP_SECRET: "secret",
    META_OAUTH_STATE_SECRET: "state-secret",
    DASHBOARD_BASE_URL: "https://dashboard.mediasis.cr",
    META_PARTNER_BUSINESS_ID: "100",
    META_PARTNER_SYSTEM_USER_TOKEN: "partner-admin",
  };
  const responseFor = (url, method) => {
    const endpoint = `${url.pathname}${method === "GET" ? "" : `:${method}`}`;
    if (endpoint === "/v26.0/200") return { error: { message: "(#100) Tried accessing nonexisting field (owner_business)", code: 100 } };
    if (endpoint === "/v26.0/100/owned_apps") return overrides.leakSecret
      ? { error: { message: "Rejected token partner-admin", code: 190 } }
      : overrides.ownedAppsDenied
        ? { error: { message: "Permission denied", code: 10 } }
        : { data: [{ id: overrides.appOwner ?? "200" }] };
    if (endpoint === "/v26.0/me/businesses") return { data: [{ id: ownerId }] };
    if (endpoint === `/v26.0/${ownerId}/owned_pixels`) return { data: overrides.unauthorized ? [] : [{ id: pixelId }] };
    if (endpoint === "/v26.0/100/managed_businesses:POST") return overrides.relationshipDenied
      ? { error: { message: "Merchant authorization denied", code: 10 } }
      : { id: ownerId };
    if (endpoint === `/v26.0/${pixelId}/assigned_users:POST`) return overrides.assignmentError
      ? { error: { message: "Meta diagnostic user-token", code: overrides.assignmentError.code, error_subcode: overrides.assignmentError.subcode, is_transient: overrides.assignmentError.transient, fbtrace_id: "trace-123" } }
      : { success: true };
    if (endpoint === `/v26.0/${ownerId}/access_token:POST`) return { access_token: "sending-token" };
    if (endpoint === "/v26.0/me") return url.searchParams.get("access_token") === "partner-admin"
      ? { id: "122116648431418663", name: "mediasis_chatwoot" }
      : { id: "500", name: "merchant-system-user" };
    if (endpoint === "/v26.0/debug_token") return { data: { app_id: "200", type: "SYSTEM_USER", is_valid: true, expires_at: overrides.expiry ?? 0 } };
    if (endpoint === `/v26.0/${pixelId}`) return overrides.pixelDenied ? { error: { message: "Permission denied" } } : { id: pixelId };
    throw new Error(`Unexpected Meta request: ${endpoint}`);
  };
  const exports = {};
  const context = vm.createContext({
    exports, process: { env }, Buffer, URL, URLSearchParams,
    require(name) { if (name === "server-only") return {}; if (name === "node:crypto") return crypto; throw new Error(name); },
    fetch: async (input, init = {}) => {
      const url = new URL(input);
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? new URLSearchParams(init.body) : null });
      const payload = responseFor(url, method);
      return { ok: !payload.error, json: async () => payload };
    },
  });
  vm.runInContext(compiled, context);
  return { api: exports, calls };
}

test("Mediasis-owned pixel reuses Mediasis's permanent system-user credential and verifies Pixel access", async () => {
  const { api, calls } = harness("100");
  const result = await api.createSendingCredential("user-token", pixelId);
  assert.equal(result.accessToken, "partner-admin");
  assert.equal(result.metaBusinessId, "100");
  assert.equal(result.systemUserId, "122116648431418663");
  const ownership = calls.find(({ url }) => url.pathname.endsWith("/owned_apps"));
  assert.equal(ownership.url.searchParams.get("access_token"), "partner-admin");
  assert.equal(calls.some(({ url }) => url.pathname === "/v26.0/200"), false);
  assert.equal(calls.some(({ url }) => url.pathname.includes("managed_businesses")), false);
  assert.equal(calls.some(({ url }) => url.pathname.endsWith("/assigned_users")), false);
  assert.equal(calls.some(({ url }) => url.pathname.endsWith("/access_tokens")), false);
  assert.equal(calls.some(({ url }) => url.pathname.endsWith("/system_user_access_tokens")), false);
  assert.equal(calls.some(({ url }) => url.pathname === `/v26.0/${pixelId}`), true);
});

test("merchant-owned pixel discovers its portfolio and uses OBO", async () => {
  const { api, calls } = harness("400");
  const result = await api.createSendingCredential("user-token", pixelId);
  assert.equal(result.metaBusinessId, "400");
  const credential = calls.find(({ url, method }) => url.pathname.endsWith("/access_token") && method === "POST");
  assert.equal(credential.body.get("scope"), "ads_management");
  const relationship = calls.find(({ url, method }) => url.pathname.endsWith("/managed_businesses") && method === "POST");
  assert.equal(relationship.body.get("existing_client_business_id"), "400");
  assert.equal(relationship.body.get("access_token"), "user-token");
  assert.equal(calls.some(({ url, method }) => url.pathname.endsWith("/managed_businesses") && method === "GET"), false);
  const assignment = calls.find(({ url, method }) => url.pathname.endsWith("/assigned_users") && method === "POST");
  assert.equal(assignment.body.has("business"), false);
  assert.equal(assignment.body.get("access_token"), "user-token");
});

test("merchant credential issuance stops when the OBO relationship is denied", async () => {
  const { api, calls } = harness("400", { relationshipDenied: true });
  await assert.rejects(() => api.createSendingCredential("user-token", pixelId), { stage: "obo-relationship" });
  assert.equal(calls.some(({ url, method }) => url.pathname.endsWith("/access_token") && method === "POST"), false);
});

test("classifies documented Meta failures without exposing diagnostics to callers", async () => {
  const cases = [
    [{ code: 10 }, "assignment-permission"],
    [{ code: 190 }, "authorization-invalid"],
    [{ code: 613 }, "temporary"],
    [{ code: 1, transient: true }, "temporary"],
    [{ code: 999 }, "unknown"],
  ];
  for (const [assignmentError, category] of cases) {
    const { api } = harness("400", { assignmentError });
    await assert.rejects(() => api.createSendingCredential("user-token", pixelId), (error) => {
      assert.equal(error.stage, "asset-assignment");
      assert.equal(api.metaFailureCategory(error), category);
      assert.equal(error.details.traceId, "trace-123");
      return true;
    });
  }
});

test("wrong app owner, denied owned_apps access, and unauthorized pixel stop before credential issuance", async () => {
  for (const overrides of [{ appOwner: "999" }, { ownedAppsDenied: true }, { unauthorized: true }]) {
    const { api, calls } = harness("100", overrides);
    await assert.rejects(() => api.createSendingCredential("user-token", pixelId));
    assert.equal(calls.some(({ url }) => url.pathname.endsWith("/access_tokens")), false);
    assert.equal(calls.some(({ url }) => url.pathname === "/v26.0/200"), false);
  }
});

test("Mediasis-owned validation errors stop after using the configured credential", async () => {
  const { api, calls } = harness("100", { pixelDenied: true });
  await assert.rejects(() => api.createSendingCredential("user-token", pixelId), (error) => {
    assert.equal(error.stage, "validation");
    return true;
  });
  assert.equal(calls.some(({ url }) => url.pathname.endsWith("/debug_token")), true);
});

test("Meta errors redact credentials before reaching callback logs", async () => {
  const { api } = harness("100", { leakSecret: true });
  await assert.rejects(() => api.createSendingCredential("user-token", pixelId), (error) => {
    assert.equal(error.stage, "configuration");
    assert.equal(error.message.includes("partner-admin"), false);
    assert.equal(error.message.includes("[redacted]"), true);
    return true;
  });
});

test("expiring or pixel-denied credentials are rejected", async () => {
  for (const overrides of [{ expiry: 9999999999 }, { pixelDenied: true }]) {
    const { api } = harness("100", overrides);
    await assert.rejects(() => api.createSendingCredential("user-token", pixelId), { stage: "validation" });
  }
});

function callbackHarness({ selectedBusiness = "foody", credentialError = false, state = true, oauthError, oauthCallbackError } = {}) {
  const writes = [];
  const logs = [];
  let exchanges = 0;
  const exports = {};
  const authorized = {
    success: true, businessId: selectedBusiness,
    context: { appUserId: "actor", user: { email: "actor@example.com" } },
    admin: { schema: () => ({ from: () => ({ update: (values) => ({ eq: async () => { writes.push(values); return { error: null }; } }) }) }) },
  };
  const response = (url) => ({ url: String(url), cookies: { delete() {} } });
  class CallbackMetaConnectionError extends Error {
    constructor(stage, details) { super("Meta diagnostic user-token"); this.stage = stage; this.details = details; }
  }
  vm.runInContext(callbackCompiled, vm.createContext({
    exports, URL, console: { error(...args) { logs.push(args); } },
    require(name) {
      if (name === "next/server") return { NextResponse: { redirect: response } };
      if (name === "@/lib/dashboard/meta-pixel-authorization") return { requireMetaPixelManagementAccess: async () => authorized };
      if (name === "@/lib/meta-pixel-connection") return {
        unsealState: () => state ? { nonce: "nonce", businessId: "foody", actorId: "actor", pixelId, expiresAt: Date.now() + 1000 } : null,
        exchangeCode: async () => { exchanges++; return "user-token"; },
        createSendingCredential: async () => { if (credentialError) throw new CallbackMetaConnectionError(oauthError?.stage ?? "asset-assignment", oauthError?.details); return { accessToken: "validated-token" }; },
        metaFailureCategory: (error) => error.details?.code === 10 ? "assignment-permission" : error.details?.code === 190 ? "authorization-invalid" : error.details?.transient ? "temporary" : "unknown",
        MetaConnectionError: CallbackMetaConnectionError,
      };
      throw new Error(name);
    },
  }));
  const request = {
    url: "https://dashboard.mediasis.cr/api/meta/callback",
    nextUrl: { searchParams: new URLSearchParams({ state: "nonce", ...(oauthCallbackError ? { error: oauthCallbackError } : { code: "one-use-code" }) }) },
    cookies: { get: () => ({ value: "sealed-state" }) },
  };
  return { api: exports, request, writes, logs, get exchanges() { return exchanges; } };
}

test("callback rejects another Mediasis business and interrupted state before exchanging code", async () => {
  for (const options of [{ selectedBusiness: "other" }, { state: false }]) {
    const flow = callbackHarness(options);
    await flow.api.GET(flow.request);
    assert.equal(flow.exchanges, 0);
    assert.equal(flow.writes.length, 0);
  }
});

test("failed reconnect leaves stored fields unchanged; success writes Pixel and token together", async () => {
  const failure = callbackHarness({ credentialError: true });
  await failure.api.GET(failure.request);
  assert.equal(failure.writes.length, 0);

  const success = callbackHarness();
  await success.api.GET(success.request);
  assert.equal(success.writes.length, 1);
  assert.equal(success.writes[0].meta_pixel_id_orders, pixelId);
  assert.equal(success.writes[0].meta_token_orders, "validated-token");
});

test("callback redirects only a fixed failure category and keeps Meta diagnostics in logs", async () => {
  const flow = callbackHarness({ credentialError: true, oauthError: { details: { code: 10, subcode: 42, transient: false, traceId: "trace-123" } } });
  const result = await flow.api.GET(flow.request);
  const redirect = new URL(result.url);
  assert.equal(redirect.searchParams.get("meta"), "failed");
  assert.equal(redirect.searchParams.get("reason"), "assignment-permission");
  assert.equal(redirect.searchParams.has("stage"), false);
  assert.equal(result.url.includes("user-token"), false);
  assert.equal(flow.writes.length, 0);
  assert.equal(flow.logs[0][1].metaCode, 10);
  assert.equal(flow.logs[0][1].metaTraceId, "trace-123");
});

test("callback distinguishes canceled Meta consent from other OAuth callback errors", async () => {
  const canceled = callbackHarness({ oauthCallbackError: "access_denied" });
  const canceledResult = new URL((await canceled.api.GET(canceled.request)).url);
  assert.equal(canceledResult.searchParams.get("meta"), "denied");
  assert.equal(canceled.exchanges, 0);

  const failed = callbackHarness({ oauthCallbackError: "server_error" });
  const failedResult = new URL((await failed.api.GET(failed.request)).url);
  assert.equal(failedResult.searchParams.get("meta"), "oauth-failed");
  assert.equal(failed.exchanges, 0);
});
