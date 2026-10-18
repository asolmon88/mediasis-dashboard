import Link from "next/link";
import { PaymentProcessingClient } from "./payment-processing-client";

export const maxDuration = 60;

export default async function PaymentProcessingPage({ searchParams }: { searchParams: Promise<{ purchase?: string; paymentError?: string }> }) {
  const { purchase, paymentError } = await searchParams;
  if (!purchase || !/^DOM-[a-zA-Z0-9]+$/.test(purchase)) return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-semibold">No pudimos identificar esta compra</h1><p className="mt-2 text-muted-foreground">{paymentError === "invalid_payment_return" ? "El regreso del procesador no incluyó la referencia de compra." : "Volvé a Dominios para consultar el estado."}</p><Link className="mt-4 inline-block text-primary underline" href="/admin/settings/domains">Volver a Dominios</Link></main>;
  return <PaymentProcessingClient purchase={purchase} />;
}
