import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { renderReceiptEscPos, type ReceiptPaperWidth } from "@/lib/orders/receipt-raster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function withRenderDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Tiempo limite al renderizar el recibo")),
          12_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function secretsMatch(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export async function POST(request: Request) {
  const configuredSecret = process.env.RECEIPT_RENDER_INTERNAL_SECRET?.trim();
  const suppliedSecret = request.headers.get("x-mediasis-render-secret")?.trim();
  if (!secretsMatch(configuredSecret, suppliedSecret)) {
    return NextResponse.json({ success: false, message: "No autorizado" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const receiptUrl = `${body.receipt_url ?? ""}`;
  const orderId = `${body.order_id ?? ""}`;
  const paperWidth: ReceiptPaperWidth = body.paper_width === "mm58" ? "mm58" : "mm80";
  if (!receiptUrl || !orderId) {
    return NextResponse.json({ success: false, message: "Datos incompletos" }, { status: 400 });
  }
  try {
    const bytes = await withRenderDeadline(renderReceiptEscPos({
      receiptUrl,
      orderId,
      paperWidth,
      supportsCutter: body.supports_cutter === true,
      businessDomain: `${body.business_domain ?? ""}`,
      readinessTimeoutMs: 8_000,
    }));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.mediasis.escpos",
        "Cache-Control": "no-store",
      },
    });
  } catch (renderError) {
    console.error("[/api/internal/orders/receipt-print-bytes] render failed", renderError);
    const timedOut = renderError instanceof Error &&
      renderError.message.includes("Tiempo limite");
    return NextResponse.json(
      {
        success: false,
        message: timedOut
          ? "El recibo visual tardo demasiado en generarse."
          : "No se pudo renderizar el recibo",
      },
      { status: timedOut ? 504 : 500 },
    );
  }
}
