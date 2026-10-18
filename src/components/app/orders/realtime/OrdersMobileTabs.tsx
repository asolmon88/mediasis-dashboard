"use client";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderSummary } from "@/lib/types/dashboardTypes";
import { OrderCard } from "./OrderCard";

type OrdersMobileTabsProps = {
  orders: OrderSummary[];
  now: Date;
  onSelect?: (order: OrderSummary) => void;
  onChangeStatus?: (order: OrderSummary, nextStatus: "preparing" | "ready") => void;
};

const sortByStatusStartedAt = (orders: OrderSummary[]) =>
  [...orders].sort(
    (a, b) =>
      new Date(a.status_started_at).getTime() - new Date(b.status_started_at).getTime()
  );

export function OrdersMobileTabs({
  orders,
  now,
  onSelect,
  onChangeStatus,
}: OrdersMobileTabsProps) {
  const nuevas = sortByStatusStartedAt(orders.filter((order) => order.order_status === "new"));
  const preparando = sortByStatusStartedAt(
    orders.filter((order) => order.order_status === "preparing")
  );
  const listas = sortByStatusStartedAt(orders.filter((order) => order.order_status === "ready"));

  return (
    <div className="lg:hidden">
      <Tabs defaultValue="new" className="w-full">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="new" className="gap-2">
            Nuevas <Badge variant="secondary">{nuevas.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="preparing" className="gap-2">
            Preparando <Badge variant="secondary">{preparando.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ready" className="gap-2">
            Listas <Badge variant="secondary">{listas.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-4 space-y-3">
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
        </TabsContent>

        <TabsContent value="preparing" className="mt-4 space-y-3">
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
        </TabsContent>

        <TabsContent value="ready" className="mt-4 space-y-3">
          {listas.map((order) => (
            <OrderCard key={order.order_id} order={order} now={now} onSelect={onSelect} />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
