import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Tilopay may prefix its own `order`; domainPayment is the merchant reference.
  const reference = url.searchParams.get("domainPayment");
  const destination = new URL("/admin/settings/domains/payment-processing", url.origin);
  if (!reference || !/^DOM-[a-zA-Z0-9]+$/.test(reference)) {
    destination.searchParams.set("paymentError", "invalid_payment_return");
    return NextResponse.redirect(destination);
  }
  destination.searchParams.set("purchase", reference);
  // Never hold Tilopay's browser redirect open during registrar or capture I/O.
  // The authenticated processing page and the scheduled recovery share the
  // same durable reconciliation routine.
  return NextResponse.redirect(destination);
}
