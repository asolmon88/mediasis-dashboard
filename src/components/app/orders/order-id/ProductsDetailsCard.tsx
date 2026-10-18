"use client";

import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderDetailItem, OrderDiscountBreakdown } from "@/lib/types/dashboardTypes";
import { formatCurrencyValue, formatProductOptions } from "@/lib/utils";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

type ProductsDetailsCardProps = {
  items: OrderDetailItem[];
  productsPrice: number | null;
  discountBreakdown?: OrderDiscountBreakdown | null;
};

export function ProductsDetailsCard({
  items,
  productsPrice,
  discountBreakdown,
}: ProductsDetailsCardProps) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const formatMoney = (value: number) => new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currencyCode }).format(value);
  const formatAmount = (value: number | null | undefined) => formatCurrencyValue(value, formatMoney);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Productos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay productos en este pedido.</p>
        ) : (
          items.map((item, index) => {
            const options = formatProductOptions(item.options, formatMoney);
            return (
              <div key={`${item.name}-${index}`} className="flex gap-3">
                <div className="relative h-12 w-12 rounded-md overflow-hidden border bg-muted">
                  {item.first_image ? (
                    <Image
                      src={item.first_image}
                      alt={item.name}
                      fill
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Cantidad: {item.quantity}
                      </p>
                    </div>
                  </div>
                  {options.length > 0 ? (
                    <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-2">
                      {options.map((option) => (
                        <li
                          key={`${option.label}-${option.values.join("-")}`}
                          className="space-y-1"
                        >
                          <span className="block">{option.label}</span>
                          {option.displayAsBullets ? (
                            <ul className="list-disc pl-5 space-y-1 text-foreground">
                              {option.values.map((value) => (
                                <li key={`${option.label}-${value}`} className="font-semibold">
                                  {value}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="block font-semibold text-foreground">
                              {option.values[0]}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            );
          })
        )}

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between text-sm font-semibold">
            <span>Total productos</span>
            <span>{formatAmount(productsPrice)}</span>
          </div>

          {discountBreakdown ? (
            <div className="space-y-1 text-sm">
              <p className="text-xs text-muted-foreground">
                Descuento aplicado: {discountBreakdown.title} ({discountBreakdown.code})
              </p>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subtotal antes del descuento</span>
                <span>
                  {formatAmount(discountBreakdown.order_total_before_discount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Descuento</span>
                <span className="text-emerald-600">
                  -{formatAmount(discountBreakdown.discount_amount)}
                </span>
              </div>
              <div className="flex items-center justify-between font-semibold">
                <span>Total final</span>
                <span>
                  {formatAmount(discountBreakdown.order_total_after_discount)}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
