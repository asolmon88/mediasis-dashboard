import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requestPickupNow } from "@/lib/orders/update-pickup-window";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return NextResponse.json(
      { success: false, message: "No autorizado" },
      { status: 401 }
    );
  }

  let orderId = "";
  try {
    const body = await request.json();
    orderId = typeof body?.orderId === "string" ? body.orderId : "";
  } catch {
    // Invalid bodies are handled below.
  }
  if (!orderId) {
    return NextResponse.json(
      { success: false, message: "El pedido es requerido" },
      { status: 400 }
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { success: false, message: "El servidor no esta configurado" },
      { status: 500 }
    );
  }

  const supabase = createSupabaseClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return NextResponse.json(
      { success: false, message: "No autorizado" },
      { status: 401 }
    );
  }

  const result = await requestPickupNow(supabase, user.id, orderId, requestId);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
