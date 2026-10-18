"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { OrderSummary } from "@/lib/types/dashboardTypes";
import { CookingPot, Sparkles, UtensilsCrossed } from "lucide-react";
import { OrderCard } from "./OrderCard";

type OrdersDesktopBoardProps = {
  orders: OrderSummary[];
  now: Date;
  onSelect?: (order: OrderSummary) => void;
  onChangeStatus?: (order: OrderSummary, nextStatus: "preparing" | "ready") => void;
  onClearReady?: () => void;
};

const sortByStatusStartedAt = (orders: OrderSummary[]) =>
  [...orders].sort(
    (a, b) =>
      new Date(a.status_started_at).getTime() - new Date(b.status_started_at).getTime()
  );

export function OrdersDesktopBoard({
  orders,
  now,
  onSelect,
  onChangeStatus,
  onClearReady,
}: OrdersDesktopBoardProps) {
  const nuevas = sortByStatusStartedAt(orders.filter((order) => order.order_status === "new"));
  const preparando = sortByStatusStartedAt(
    orders.filter((order) => order.order_status === "preparing")
  );
  const listas = sortByStatusStartedAt(orders.filter((order) => order.order_status === "ready"));

  return (
    <div className="hidden lg:grid grid-cols-3 gap-4">
      <Card className="p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Nuevas</h2>
          </div>
          <Badge variant="secondary">{nuevas.length}</Badge>
        </div>
        <div className="flex flex-col gap-3">
          {nuevas.map((order) => (
            <OrderCard
              key={order.order_id}
              order={order}
              now={now}
              onSelect={onSelect}
              onCtaClick={() => onChangeStatus?.(order, "preparing")}
              ctaLabel="Marcar como preparando"
            />
          ))}
        </div>
      </Card>

      <Card className="p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CookingPot className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Preparando</h2>
          </div>
          <Badge variant="secondary">{preparando.length}</Badge>
        </div>
        <div className="flex flex-col gap-3">
          {preparando.map((order) => (
            <OrderCard
              key={order.order_id}
              order={order}
              now={now}
              onSelect={onSelect}
              onCtaClick={() => onChangeStatus?.(order, "ready")}
              ctaLabel="Marcar como lista"
            />
          ))}
        </div>
      </Card>

      <Card className="p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Listas</h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{listas.length}</Badge>
            <button
              type="button"
              onClick={onClearReady}
              className="text-xs font-medium text-primary hover:underline cursor-pointer"
            >
              Limpiar
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {listas.map((order) => (
            <OrderCard key={order.order_id} order={order} now={now} onSelect={onSelect} />
          ))}
        </div>
      </Card>
    </div>
  );
}
