import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type TokenizationSession = {
  business_card_tokenization_session_id: string;
  callback_secret: string;
  business_id: string;
  owner_app_user_id: string;
  billing_email: string;
  card_label: string | null;
  recurring_consent_at: string | null;
  status: "pending" | "completed" | "failed" | "expired";
  expires_at: string;
};

function stringValue(value: FormDataEntryValue | string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function findToken(values: Record<string, string>) {
  const directKeys = ["token", "cardToken", "card_token", "subscriptionToken", "subscription_token"];
  for (const key of directKeys) {
    const candidate = values[key]?.trim();
    if (candidate && candidate.length >= 8 && candidate.length <= 1_000) return candidate;
  }
  // Some gateways nest their final result as JSON in one field. Accept only a
  // documented token-shaped value, never card number or CVV fields.
  for (const value of Object.values(values)) {
    if (!value.startsWith("{") || value.length > 10_000) continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      for (const key of directKeys) {
        const candidate = typeof parsed[key] === "string" ? parsed[key].trim() : "";
        if (candidate && candidate.length >= 8 && candidate.length <= 1_000) return candidate;
      }
    } catch { /* Not JSON; continue searching. */ }
  }
  return "";
}

async function callbackValues(request: Request) {
  const url = new URL(request.url);
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) values[key] = value;
  if (request.method !== "POST") return values;
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = await request.json() as Record<string, unknown>;
      for (const [key, value] of Object.entries(body)) if (typeof value === "string") values[key] = value;
    } else {
      const body = await request.formData();
      for (const [key, value] of body.entries()) values[key] = stringValue(value);
    }
  } catch { /* The provider can still return a GET callback. */ }
  return values;
}

function destinationFor(request: Request, businessId: string, result: "saved" | "failed") {
  const destination = new URL("/clerk-auth/onboarding/payment", request.url);
  destination.searchParams.set("business", businessId);
  destination.searchParams.set("card", result);
  return destination;
}

function redirect(destination: URL) {
  const response = NextResponse.redirect(destination);
  // The processor return may contain a reusable token. Immediately redirect
  // to a clean URL and prevent browser/proxy caching or referrer forwarding.
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function handle(request: Request) {
  const values = await callbackValues(request);
  const sessionId = values.session;
  const callbackSecret = values.state;
  if (!sessionId || !callbackSecret) return redirect(new URL("/clerk-auth/onboarding", request.url));

  const admin = createAdminClient();
  const { data: session, error } = await admin.schema("mediasis").from("business_card_tokenization_sessions")
    .select("business_card_tokenization_session_id,callback_secret,business_id,owner_app_user_id,billing_email,card_label,recurring_consent_at,status,expires_at")
    .eq("business_card_tokenization_session_id", sessionId)
    .eq("callback_secret", callbackSecret)
    .maybeSingle<TokenizationSession>();
  if (error || !session) return redirect(new URL("/clerk-auth/onboarding", request.url));

  const destination = destinationFor(request, session.business_id, "failed");
  if (session.status === "completed") return redirect(destinationFor(request, session.business_id, "saved"));
  if (session.status !== "pending" || new Date(session.expires_at) <= new Date() || !session.recurring_consent_at) {
    await admin.schema("mediasis").from("business_card_tokenization_sessions")
      .update({ status: "expired", failure_reason: "expired_or_not_authorized" })
      .eq("business_card_tokenization_session_id", session.business_card_tokenization_session_id)
      .eq("status", "pending");
    return redirect(destination);
  }

  const cardToken = findToken(values);
  if (!cardToken) {
    await admin.schema("mediasis").from("business_card_tokenization_sessions")
      .update({ status: "failed", failure_reason: "missing_card_token" })
      .eq("business_card_tokenization_session_id", session.business_card_tokenization_session_id)
      .eq("status", "pending");
    return redirect(destination);
  }

  const { data: activated, error: activationError } = await admin.schema("mediasis").rpc("activate_business_subscription_trial", {
    p_owner_app_user_id: session.owner_app_user_id,
    p_business_id: session.business_id,
    p_card_token: cardToken,
    p_cardholder_email: session.billing_email,
    p_card_brand: values.brand ?? "",
    p_card_label: session.card_label ?? values.cardName ?? values.card_name ?? "",
    p_consent_version: "2026-10-07",
  });
  if (activationError || !activated?.success) {
    await admin.schema("mediasis").from("business_card_tokenization_sessions")
      .update({ status: "failed", failure_reason: "card_activation_failed" })
      .eq("business_card_tokenization_session_id", session.business_card_tokenization_session_id)
      .eq("status", "pending");
    return redirect(destination);
  }
  await admin.schema("mediasis").from("business_card_tokenization_sessions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("business_card_tokenization_session_id", session.business_card_tokenization_session_id)
    .eq("status", "pending");
  return redirect(destinationFor(request, session.business_id, "saved"));
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
