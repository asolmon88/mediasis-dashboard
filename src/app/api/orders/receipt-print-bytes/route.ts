import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { renderReceiptEscPos, type ReceiptPaperWidth } from "@/lib/orders/receipt-raster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function withRenderDeadline<T>(
  operation: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Tiempo limite al renderizar el recibo")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function bearerToken(request: Request) {
  const [scheme, token] = (request.headers.get("Authorization") ?? "").split(" ");
  return scheme === "Bearer" && token ? token : null;
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ success: false, message: "No autorizado" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const orderId = `${body.order_id ?? ""}`;
  const locationId = `${body.business_location_id ?? ""}`;
  const paperWidth: ReceiptPaperWidth = body.paper_width === "mm58" ? "mm58" : "mm80";
  const requestedTimeout = Number(body.render_timeout_ms);
  const renderTimeout = Number.isFinite(requestedTimeout)
    ? Math.min(30_000, Math.max(3_000, requestedTimeout))
    : 30_000;
  if (!orderId || !locationId) {
    return NextResponse.json({ success: false, message: "Datos incompletos" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ success: false, message: "Supabase no esta configurado" }, { status: 500 });
  }
  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ success: false, message: "No autorizado" }, { status: 401 });
  }
  const { data, error } = await supabase.schema("mediasis").rpc(
    "get_receipt_print_data_for_dashboard",
    { p_order_id: orderId, p_business_location_id: locationId },
  );
  const payload = data as { success?: boolean; data?: Record<string, unknown>; message?: string } | null;
  if (error || !payload?.success || !payload.data) {
    return NextResponse.json({ success: false, message: payload?.message ?? "No se encontro el recibo" }, { status: 404 });
  }
  const order = payload.data.order as Record<string, unknown> | undefined;
  const business = payload.data.business as Record<string, unknown> | undefined;
  const receiptUrl = `${order?.receipt_url ?? ""}`;
  try {
    const bytes = await withRenderDeadline(
      renderReceiptEscPos({
        receiptUrl,
        orderId,
        paperWidth,
        supportsCutter: body.supports_cutter === true,
        businessDomain: `${business?.domain ?? ""}`,
        readinessTimeoutMs: Math.min(10_000, renderTimeout),
      }),
      renderTimeout,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.mediasis.escpos",
        "Cache-Control": "no-store",
      },
    });
  } catch (renderError) {
    console.error("[/api/orders/receipt-print-bytes] render failed", renderError);
    const timedOut = renderError instanceof Error &&
      renderError.message.includes("Tiempo limite");
    return NextResponse.json(
      {
        success: false,
        message: timedOut
          ? "El recibo visual tardo demasiado en generarse. Intenta nuevamente."
          : "No se pudo renderizar el recibo",
      },
      { status: timedOut ? 504 : 500 },
    );
  }
}
