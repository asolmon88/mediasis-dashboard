"use client";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";
export function MarketCurrencyCode() {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const symbol = new Intl.NumberFormat(market.locale, {
    style: "currency",
    currency: market.currencyCode,
    currencyDisplay: "narrowSymbol",
  }).formatToParts(0).find((part) => part.type === "currency")?.value;
  return <>{symbol ?? market.currencyCode}</>;
}
