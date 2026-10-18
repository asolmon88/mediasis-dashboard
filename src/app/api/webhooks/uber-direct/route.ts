import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type UberDirectPayload = {
  id?: string;
  kind?: string;
  delivery_id?: string;
  data?: {
    id?: string;
  };
};

type ProcessWebhookRpcResult = {
  success: boolean;
  data?: {
    processed?: boolean;
    reason?: string;
    order_id?: string | null;
    delivery_id?: string | null;
    event_id?: string | null;
  };
  message?: string;
};

const SUPPORTED_KINDS = new Set(["event.delivery_status", "event.courier_update"]);

const UNAUTHORIZED_REASONS = new Set([
  "missing_signature",
  "invalid_signature",
  "missing_webhook_key",
]);

function getSignatureHeader(request: Request): string | null {
  return request.headers.get("x-uber-signature") ?? request.headers.get("x-postmates-signature");
}

function getSupabaseEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return { supabaseUrl, supabaseAnonKey };
}

export async function POST(request: Request): Promise<NextResponse> {
  const signature = getSignatureHeader(request);
  if (!signature) {
    return NextResponse.json(
      { success: false, message: "Missing webhook signature header" },
      { status: 401 }
    );
  }

  const rawPayload = await request.text();
  if (!rawPayload) {
    return NextResponse.json({ success: true, data: { processed: false, reason: "empty_body" } });
  }

  let payload: UberDirectPayload;
  try {
    payload = JSON.parse(rawPayload) as UberDirectPayload;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  if (!payload.kind || !SUPPORTED_KINDS.has(payload.kind)) {
    return NextResponse.json({
      success: true,
      data: {
        processed: false,
        reason: "ignored_kind",
        event_id: payload.id ?? null,
        delivery_id: payload.delivery_id ?? payload.data?.id ?? null,
      },
    });
  }

  if (!payload.delivery_id && !payload.data?.id) {
    return NextResponse.json(
      { success: false, message: "Missing delivery identifier" },
      { status: 400 }
    );
  }

  const env = getSupabaseEnv();
  if (!env) {
    return NextResponse.json(
      { success: false, message: "Supabase env vars are not configured" },
      { status: 500 }
    );
  }

  const supabase = createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey);
  const { data, error } = await supabase
    .schema("mediasis")
    .rpc("process_uber_direct_webhook", {
      p_signature: signature,
      p_raw_payload: rawPayload,
    });

  if (error) {
    console.error("Uber webhook RPC error:", error.message);
    return NextResponse.json(
      { success: false, message: "Failed to process webhook" },
      { status: 500 }
    );
  }

  const result = data as ProcessWebhookRpcResult | null;
  if (!result?.success) {
    console.error("Uber webhook RPC returned failure:", result?.message ?? "unknown");
    return NextResponse.json(
      { success: false, message: result?.message ?? "Webhook processing failed" },
      { status: 500 }
    );
  }

  const reason = result.data?.reason ?? "unknown";
  const statusCode = UNAUTHORIZED_REASONS.has(reason) ? 401 : 200;

  if (statusCode === 401) {
    console.warn("Uber webhook rejected:", {
      reason,
      eventId: payload.id ?? null,
      deliveryId: payload.delivery_id ?? payload.data?.id ?? null,
    });
  }

  return NextResponse.json(result, { status: statusCode });
}
