"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type OnvoDetailsCardProps = {
  productsPaymentIntentId: string | null;
  deliveryPaymentIntentId: string | null;
};

export function OnvoDetailsCard({
  productsPaymentIntentId,
  deliveryPaymentIntentId,
}: OnvoDetailsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Informacion de los pagos por OnvoPay</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Intento productos</span>
          <span>{productsPaymentIntentId ?? "No hay informacion de pago de productos"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Intento delivery</span>
          <span>{deliveryPaymentIntentId ?? "No hay informacion de pago de delivery"}</span>
        </div>
      </CardContent>
    </Card>
  );
}
