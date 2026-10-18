import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createUberDelivery } from "@/lib/orders/create-uber-delivery";

/**
 * Manual Uber delivery dispatch endpoint for realtime orders.
 *
 * POST /api/orders/realtime/call-uber
 *
 * Creates a new Uber Direct delivery for an order. If an active delivery
 * exists, it attempts to cancel it first before creating a new one.
 *
 * Authentication:
 * Send the current logged-in Supabase access token in the Authorization header.
 *
 * Required headers:
 * Content-Type: application/json
 * Authorization: Bearer <supabase_access_token>
 *
 * Request body:
 * { "orderId": "uuid-string" }
 *
 * Success response (200):
 * { "success": true }
 *
 * Failure response:
 * { "success": false, "message": "..." }
 */

type RequestBody = {
  orderId?: string;
};

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, message: "Missing Authorization bearer token" },
      { status: 401 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { success: false, message: "Supabase env vars are not configured" },
      { status: 500 }
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) {
    return NextResponse.json(
      { success: false, message: "orderId is required" },
      { status: 400 }
    );
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return NextResponse.json(
      { success: false, message: "No autorizado" },
      { status: 401 }
    );
  }

  const result = await createUberDelivery(supabase, user.id, orderId);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
