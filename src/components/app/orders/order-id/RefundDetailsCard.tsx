"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { OrderRefundRecord } from "@/app/admin/orders/[order_id]/actions";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";
import type { BusinessMarket } from "@/lib/dashboard/auth-types";

type Props = {
  refunds: OrderRefundRecord[];
};

const unavailable = "No disponible";

const statusLabels: Record<OrderRefundRecord["status"], string> = {
  creating: "Creando",
  pending: "Pendiente",
  succeeded: "Exitoso",
  failed: "Fallido",
};

function formatAmount(amountMinor: number | null, currency: string | null, locale: string) {
  if (amountMinor === null || !currency) return unavailable;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${amountMinor / 100} ${currency}`;
  }
}

function formatDate(value: string | null, market: BusinessMarket) {
  if (!value) return unavailable;
  return new Intl.DateTimeFormat(market.locale, {
    timeZone: market.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ReceiptRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-right">{value || unavailable}</span>
    </div>
  );
}

function receiptText(refund: OrderRefundRecord, market: BusinessMarket) {
  return [
    "Comprobante de reembolso",
    `Comercio: ${refund.merchant_name || unavailable}`,
    `Monto reembolsado: ${formatAmount(refund.amount_minor, refund.currency, market.locale)}`,
    `Estado: ${statusLabels[refund.status]}`,
    `Número de autorización: ${refund.authorization_number || unavailable}`,
    `Fecha y hora: ${formatDate(refund.provider_created_at ?? refund.created_at, market)}`,
    `Número de referencia: ${refund.reference_number || unavailable}`,
    `Referencia de transacción: ${refund.transaction_reference || unavailable}`,
    `ID de reembolso: ${refund.provider_refund_id || unavailable}`,
    `Pago original: ${refund.payment_intent_id || unavailable}`,
    ...(refund.failure_reason
      ? [`Motivo del fallo: ${refund.failure_reason}`]
      : []),
  ].join("\n");
}

async function copyReceipt(refund: OrderRefundRecord, market: BusinessMarket) {
  try {
    await navigator.clipboard.writeText(receiptText(refund, market));
    toast.success("Comprobante copiado");
  } catch {
    toast.error("No se pudo copiar el comprobante");
  }
}

export function RefundDetailsCard({ refunds }: Props) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  if (refunds.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <CardTitle className="min-w-0 break-words text-base leading-snug">
          Comprobante de reembolso
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-w-0 max-w-[55%] shrink-0 whitespace-normal py-1.5 text-left leading-tight"
          onClick={() => void copyReceipt(refunds[0], market)}
        >
          <Copy className="h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">Copiar comprobante</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {refunds.map((refund, index) => (
          <div
            key={refund.order_refund_id}
            className={index > 0 ? "space-y-2 border-t pt-5" : "space-y-2"}
          >
            <ReceiptRow label="Comercio" value={refund.merchant_name} />
            <ReceiptRow
              label="Monto reembolsado"
              value={formatAmount(refund.amount_minor, refund.currency, market.locale)}
            />
            <ReceiptRow
              label="Tipo"
              value={refund.refund_kind === "partial" ? "Parcial" : "Total"}
            />
            <ReceiptRow label="Estado" value={statusLabels[refund.status]} />
            <ReceiptRow label="Número de autorización" value={refund.authorization_number} />
            <ReceiptRow
              label="Fecha y hora"
              value={formatDate(refund.provider_created_at ?? refund.created_at, market)}
            />
            <ReceiptRow label="Número de referencia" value={refund.reference_number} />
            <ReceiptRow label="Referencia de transacción" value={refund.transaction_reference} />
            <ReceiptRow label="ID de reembolso" value={refund.provider_refund_id} />
            <ReceiptRow label="Pago original" value={refund.payment_intent_id} />
            {refund.failure_reason ? (
              <ReceiptRow label="Motivo del fallo" value={refund.failure_reason} />
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
