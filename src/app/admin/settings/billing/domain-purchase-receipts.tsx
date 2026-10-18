import { CheckCircle2, Mail, ReceiptText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DomainPurchaseReceipt } from "./actions";

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(amountMinor / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CR", { dateStyle: "medium", timeZone: "America/Costa_Rica" }).format(new Date(value));
}

export function DomainPurchaseReceipts({ receipts }: { receipts: DomainPurchaseReceipt[] }) {
  return <Card>
    <CardHeader>
      <CardTitle>Comprobantes de dominios</CardTitle>
      <CardDescription>Las compras confirmadas quedan disponibles para tu negocio.</CardDescription>
    </CardHeader>
    <CardContent>
      {receipts.length === 0 ? <div className="rounded-xl border border-dashed bg-muted/20 px-5 py-8 text-center">
        <ReceiptText className="mx-auto mb-3 size-6 text-muted-foreground" />
        <p className="font-medium">Todavía no hay comprobantes</p>
        <p className="mt-1 text-sm text-muted-foreground">Cuando compres un dominio, vas a ver el pago confirmado aquí.</p>
      </div> : <div className="grid gap-3">
        {receipts.map((receipt) => <div key={receipt.billing_receipt_id} className="flex flex-col gap-4 rounded-xl border bg-gradient-to-br from-white to-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="size-5" /></div>
            <div className="min-w-0"><p className="truncate font-semibold">{receipt.purchased_domain}</p><p className="mt-0.5 text-sm text-muted-foreground">{formatDate(receipt.paid_at)} · {receipt.receipt_number}</p><p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Mail className="size-3" /> {receipt.email_delivery_status === "sent" ? "Enviado a" : "Entrega pendiente para"} {receipt.receipt_email}</p></div>
          </div>
          <div className="flex items-center justify-between gap-3 sm:block sm:text-right"><Badge variant="secondary" className="bg-emerald-50 text-emerald-700">Pago confirmado</Badge><p className="mt-1 font-semibold">{formatMoney(receipt.amount_minor, receipt.currency_code)}</p></div>
        </div>)}
      </div>}
    </CardContent>
  </Card>;
}
