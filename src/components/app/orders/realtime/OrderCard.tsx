"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { OrderSummary } from "@/lib/types/dashboardTypes";
import { normalizeExternalUrl } from "@/lib/utils";
import { ArrowRight, ExternalLink, ReceiptText, Timer, User } from "lucide-react";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

const uberStatusConfig: Record<string, { label: string; className: string }> = {
  pending:        { label: "Pendiente",  className: "bg-gray-100 text-gray-700 border-gray-200" },
  pickup:         { label: "Recogiendo", className: "bg-blue-100 text-blue-800 border-blue-200" },
  pickup_complete:{ label: "Recogido",   className: "bg-blue-100 text-blue-800 border-blue-200" },
  dropoff:        { label: "En camino",  className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  delivered:      { label: "Entregado",  className: "bg-green-100 text-green-800 border-green-200" },
  canceled:       { label: "Cancelado",  className: "bg-red-100 text-red-800 border-red-200" },
  returned:       { label: "Devuelto",   className: "bg-orange-100 text-orange-800 border-orange-200" },
};

type OrderCardProps = {
  order: OrderSummary;
  now: Date;
  ctaLabel?: string;
  onSelect?: (order: OrderSummary) => void;
  onCtaClick?: (order: OrderSummary) => void;
};

const formatElapsed = (elapsedSeconds: number) => {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = Math.max(0, elapsedSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const getUrgencyClass = (elapsedSeconds: number) => {
  if (elapsedSeconds >= 900) return "bg-red-500";
  if (elapsedSeconds >= 300) return "bg-yellow-500";
  return "bg-green-500";
};

export function OrderCard({
  order,
  now,
  ctaLabel,
  onSelect,
  onCtaClick,
}: OrderCardProps) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const formatCurrency = (amount: number | null) => amount === null ? "-" : new Intl.NumberFormat(market.locale, {
    style: "currency", currency: market.currencyCode,
  }).format(amount);
  const statusStartedAt = new Date(order.status_started_at);
  const elapsedSeconds = Math.max(
    0,
    Math.floor((now.getTime() - statusStartedAt.getTime()) / 1000)
  );
  const urgencyClass = getUrgencyClass(elapsedSeconds);
  const isReady = order.order_status === "ready";
  const trackingUrl = normalizeExternalUrl(order.tracking_link);
  const receiptUrl = normalizeExternalUrl(order.receipt_url);

  return (
    <Card
      className="p-4 flex flex-col gap-3 cursor-pointer transition hover:shadow-sm"
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(order)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(order);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-semibold">Orden #{order.human_order_number}</p>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm">{`${order.client.first_name} ${order.client.last_name}`}</p>
          </div>
          {order.uber_delivery_status && (() => {
            const cfg = uberStatusConfig[order.uber_delivery_status];
            return (
              <Badge variant="outline" className={`text-xs ${cfg?.className ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                Uber: {cfg?.label ?? order.uber_delivery_status}
              </Badge>
            );
          })()}
        </div>
        {!isReady ? (
          <span className={`h-3 w-3 rounded-full ${urgencyClass}`} aria-hidden="true" />
        ) : null}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{formatCurrency(order.amount)}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {receiptUrl ? (
          <Button
            asChild
            size="sm"
            variant="outline"
            onClick={(event) => event.stopPropagation()}
          >
            <a href={receiptUrl} target="_blank" rel="noreferrer">
              <ReceiptText className="h-4 w-4" />
              Ver recibo
            </a>
          </Button>
        ) : null}
        {trackingUrl ? (
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="px-0"
            onClick={(event) => event.stopPropagation()}
          >
            <a href={trackingUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Rastreo
            </a>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">Sin rastreo</span>
        )}
      </div>

      {!isReady ? (
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{formatElapsed(elapsedSeconds)}</span>
          </div>
          <span className="text-primary text-xs">Ver detalles</span>
        </div>
      ) : null}

      {ctaLabel ? (
        <Button
          size="sm"
          className="w-full"
          onClick={(event) => {
            event.stopPropagation();
            onCtaClick?.(order);
          }}
        >
          <ArrowRight className="h-4 w-4" />
          {ctaLabel}
        </Button>
      ) : null}
    </Card>
  );
}
