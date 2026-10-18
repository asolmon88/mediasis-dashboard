"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderDiscountBreakdown } from "@/lib/types/dashboardTypes";
import { formatCurrencyValue } from "@/lib/utils";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

type PaymentDetailsCardProps = {
  paymentMethodName: string | null;
  productsPrice: number | null;
  deliveryPrice: number | null;
  productsPaymentStatus: string | null;
  deliveryPaymentStatus: string | null;
  discountBreakdown?: OrderDiscountBreakdown | null;
};

export function PaymentDetailsCard({
  paymentMethodName,
  productsPrice,
  deliveryPrice,
  productsPaymentStatus,
  deliveryPaymentStatus,
  discountBreakdown,
}: PaymentDetailsCardProps) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const formatMoney = (value: number) => new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currencyCode }).format(value);
  const formatAmount = (value: number | null | undefined) => formatCurrencyValue(value, formatMoney);
  const productsSubtotal =
    discountBreakdown && typeof discountBreakdown.order_total_before_discount === "number"
      ? discountBreakdown.order_total_before_discount
      : typeof productsPrice === "number"
        ? productsPrice
        : 0;
  const discountedProductsTotal =
    discountBreakdown && typeof discountBreakdown.order_total_after_discount === "number"
      ? discountBreakdown.order_total_after_discount
      : typeof productsPrice === "number"
        ? productsPrice
        : 0;
  const delivery = typeof deliveryPrice === "number" ? deliveryPrice : 0;
  const total = discountedProductsTotal + delivery;
  const amountPaid =
    productsPaymentStatus === "paid" && (!delivery || deliveryPaymentStatus === "paid")
      ? total
      : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pago</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Metodo de pago</span>
          <span>{paymentMethodName ?? "No hay informacion de metodo de pago"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">
            {discountBreakdown ? "Subtotal productos" : "Total productos"}
          </span>
          <span>{formatAmount(productsSubtotal)}</span>
        </div>
        {discountBreakdown ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Descuento</span>
              <span className="text-emerald-600">
                -{formatAmount(discountBreakdown.discount_amount)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total productos con descuento</span>
              <span>{formatAmount(discountedProductsTotal)}</span>
            </div>
          </>
        ) : null}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Total delivery</span>
          <span>
            {deliveryPrice !== null
              ? formatAmount(deliveryPrice)
              : "No hay informacion de delivery"}
          </span>
        </div>
        <div className="flex items-center justify-between border-t pt-3 font-semibold">
          <span>Total pedido</span>
          <span>{formatAmount(total)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Monto pagado</span>
          <span>{formatAmount(amountPaid)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Monto pendiente</span>
          <span>{formatAmount(total - amountPaid)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
