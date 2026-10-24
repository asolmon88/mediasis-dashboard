import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { updatePickupWindow } from "@/lib/orders/update-pickup-window";

/**
 * Pickup window update endpoint for realtime orders.
 *
 * Endpoint:
 * POST /api/orders/realtime/pickup-window
 *
 * Purpose:
 * Updates pickup_ready_dt / pickup_deadline_dt for an order.
 * If the order is an Uber courier order, it also updates the pickup window in Uber.
 *
 * Authentication:
 * Send the current logged-in Supabase access token in the Authorization header.
 * Do NOT send the anon key here.
 *
 * Required headers:
 * Content-Type: application/json
 * Authorization: Bearer <supabase_access_token>
 *
 * Request body:
 * {
 *   "orderId": "uuid-string",
 *   "readyInMinutes": 5
 * }
 *
 * Success response (200):
 * { "success": true }
 *
 * Failure response examples:
 * { "success": false, "message": "No autorizado" }
 * { "success": false, "message": "Pedido no encontrado" }
 *
 * Common HTTP statuses:
 * 200 -> Request processed, check `success`
 * 400 -> Invalid body or missing required fields
 * 401 -> Missing or invalid bearer token
 * 500 -> Server/env configuration error
 *
 * Flutter example:
 * final response = await http.post(
 *   Uri.parse('$baseUrl/api/orders/realtime/pickup-window'),
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'Authorization': 'Bearer ${session.accessToken}',
 *   },
 *   body: jsonEncode({
 *     'orderId': orderId,
 *     'readyInMinutes': 5,
 *   }),
 * );
 */

type PickupWindowRequestBody = {
  orderId?: string;
  readyInMinutes?: number;
};

const MAX_PREPARATION_MINUTES = 20;
const MAX_PREPARATION_MINUTES_MESSAGE =
  "No se permite configurar un tiempo de preparación mayor a 20 minutos.";

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

  let body: PickupWindowRequestBody;
  try {
    body = (await request.json()) as PickupWindowRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const readyInMinutes =
    typeof body.readyInMinutes === "number" ? body.readyInMinutes : Number.NaN;

  if (!orderId || !Number.isFinite(readyInMinutes)) {
    return NextResponse.json(
      { success: false, message: "orderId and readyInMinutes are required" },
      { status: 400 }
    );
  }

  if (readyInMinutes > MAX_PREPARATION_MINUTES) {
    return NextResponse.json(
      { success: false, message: MAX_PREPARATION_MINUTES_MESSAGE },
      { status: 400 }
    );
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
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

  const result = await updatePickupWindow(supabase, user.id, orderId, readyInMinutes);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
