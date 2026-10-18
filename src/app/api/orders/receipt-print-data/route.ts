import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { success: false, message: "No autorizado" },
      { status: 401 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { success: false, message: "Supabase no esta configurado" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id") ?? "";
  const businessLocationId = searchParams.get("business_location_id") ?? "";
  if (!orderId || !businessLocationId) {
    return NextResponse.json(
      { success: false, message: "order_id y business_location_id son requeridos" },
      { status: 400 }
    );
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json(
      { success: false, message: "No autorizado" },
      { status: 401 }
    );
  }

  const { data, error } = await supabase
    .schema("mediasis")
    .rpc("get_receipt_print_data_for_dashboard", {
      p_order_id: orderId,
      p_business_location_id: businessLocationId,
    });

  if (error) {
    console.error("[/api/orders/receipt-print-data] RPC failed", error);
    return NextResponse.json(
      { success: false, message: "No se pudo cargar el recibo" },
      { status: 500 }
    );
  }

  const payload = data as { success?: boolean; data?: unknown; message?: string } | null;
  if (!payload?.success || !payload.data) {
    return NextResponse.json(
      { success: false, message: payload?.message ?? "No se encontro el recibo" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: payload.data });
}
