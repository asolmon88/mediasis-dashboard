"use client";

import { useEffect, useRef, useState } from "react";
import {
  OrderRealtimeOrder,
  OrderRealtimeResponse,
  OrderSummary,
} from "@/lib/types/dashboardTypes";
import { OrdersDesktopBoard } from "./OrdersDesktopBoard";
import { OrdersMobileTabs } from "./OrdersMobileTabs";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { toast } from "sonner";
import { OrderDetailSheet } from "./OrderDetailSheet";
import { NotificationsControl } from "./NotificationsControl";
import { NotificationsManager } from "./NotificationsManager";
import { RealtimeSoundControl } from "./RealtimeSoundControl";
import { useActiveLocationId } from "@/stores/location-store";
import { useDashboardAccessToken, useDashboardSupabase } from "@/hooks/use-dashboard-supabase";

export default function MainPage() {
  const supabase = useDashboardSupabase();
  const getAccessToken = useDashboardAccessToken();
  const businessLocationId = useActiveLocationId();
  const [now, setNow] = useState(new Date());
  const [ordersRaw, setOrdersRaw] = useState<OrderRealtimeOrder[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [lastNotifiedOrderId, setLastNotifiedOrderId] = useState<string | null>(null);
  const [soundTriggerId, setSoundTriggerId] = useState<string | null>(null);
  const ordersRawRef = useRef<OrderRealtimeOrder[]>([]);
  const activeLocationIdRef = useRef<string | null>(businessLocationId);
  const pendingUpdateRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastVisibilityRebindRef = useRef(0);
  const lastMoveRef = useRef<{
    orderId: string;
    previousStatus: OrderSummary["order_status"];
    previousStatusStartedAt: string;
    nextStatus: "preparing" | "ready";
  } | null>(null);

  activeLocationIdRef.current = businessLocationId;

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      setNotificationsEnabled(true);
    }
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        setNewOrdersCount(0);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    ordersRawRef.current = ordersRaw;
  }, [ordersRaw]);

  const requestNotificationPermission = async () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      toast.error("Este navegador no soporta notificaciones.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === "granted");
    if (permission !== "granted") {
      toast.error("No se pudieron activar las notificaciones.");
    }
  };


  const normalizeStatus = (status: OrderRealtimeOrder["order_status"]) => {
    if (status === "pending") return "new";
    if (status === "new" || status === "preparing" || status === "ready") return status;
    return null;
  };

  const mapOrderToSummary = (
    order: OrderRealtimeOrder,
    previous?: OrderSummary | null
  ): OrderSummary | null => {
    const normalizedStatus = normalizeStatus(order.order_status);
    if (!normalizedStatus) return null;

    const deliveryPrice =
      typeof order.delivery_price === "number" && Number.isFinite(order.delivery_price)
        ? order.delivery_price
        : 0;
    const safeDeliveryPrice = deliveryPrice > 0 ? deliveryPrice : 0;
    const amount =
      typeof order.products_price === "number"
        ? order.products_price + safeDeliveryPrice
        : order.items?.reduce((total, item) => {
            const itemTotal = Number(item.total_price ?? 0);
            return total + (Number.isNaN(itemTotal) ? 0 : itemTotal);
          }, 0) + safeDeliveryPrice;

    const statusStartedAt =
      previous && previous.order_status === normalizedStatus
        ? previous.status_started_at
        : new Date().toISOString();

    return {
      order_id: order.order_id,
      human_order_number: order.human_order_number,
      receipt_url: order.receipt_url,
      created_at: order.created_at,
      amount: amount ?? null,
      client: {
        first_name: order.client.first_name,
        last_name: order.client.last_name,
        phone_number: order.client.phone_number,
      },
      tracking_link: order.tracking_link,
      order_status: normalizedStatus,
      status_started_at: previous ? statusStartedAt : order.created_at,
      uber_delivery_status: order.uber_delivery?.status ?? null,
    };
  };

  const fetchOrders = async (locationId: string) => {
    const { data, error } = await supabase
      .schema("mediasis")
      .rpc("get_orders_for_real_time", { p_business_location_id: locationId });

    if (error) {
      toast.error(`soy el error ${error.message}`);
      return;
    }

    const response = data as OrderRealtimeResponse | null;
    if (activeLocationIdRef.current !== locationId) return;
    if (!response?.success) {
      toast.error(response?.message ?? "Error al cargar pedidos");
      return;
    }

    const ordersData = (response.data ?? []) as OrderRealtimeOrder[];
    const orderIds = ordersData.map((order) => order.order_id);
    const { data: deliveryRows } = orderIds.length
      ? await supabase
          .schema("mediasis")
          .rpc("get_my_business_order_delivery_totals", { p_order_ids: orderIds })
      : { data: [] };
    const deliveryTotalByOrderId = new Map<
      string,
      number
    >(
      ((deliveryRows ?? []) as Array<{ order_id: string; delivery_total: number }>).map(
        (row) => [
          row.order_id,
          Number(row.delivery_total ?? 0),
        ]
      )
    );
    // The service component is private Mediasis accounting. Pharmacy clients
    // receive only one combined customer-facing delivery amount.
    const ordersWithFees = ordersData.map((order) => {
      return {
        ...order,
        delivery_price:
          deliveryTotalByOrderId.get(order.order_id) ?? order.delivery_price,
      };
    });
    const mapped = ordersWithFees
      .map((order) => mapOrderToSummary(order, null))
      .filter((order): order is OrderSummary => Boolean(order));

    setOrdersRaw(ordersWithFees);
    setOrders(mapped);
  };

  const fetchOneOrder = async (
    requestClient: typeof supabase,
    orderId: string,
    businessLocationId: string
  ) => {
    const { data, error } = await requestClient
      .schema("mediasis")
      .rpc("get_order_for_real_time", {
        p_order_id: orderId,
        p_business_location_id: businessLocationId,
      });

    if (error) throw error;
    const response = data as OrderRealtimeResponse | null;
    if (!response?.success || !response.data || Array.isArray(response.data)) return response;
    const { data: deliveryRows } = await requestClient
      .schema("mediasis")
      .rpc("get_my_business_order_delivery_totals", { p_order_ids: [orderId] });
    const deliveryTotal = (deliveryRows as Array<{ delivery_total: number }> | null)?.[0]
      ?.delivery_total;
    return {
      ...response,
      data: {
        ...response.data,
        delivery_price: deliveryTotal ?? response.data.delivery_price,
      },
    } as OrderRealtimeResponse;
  };

  const upsertRealtimeOrder = (orderData: OrderRealtimeOrder) => {
    setOrdersRaw((prev) => {
      const exists = prev.some((order) => order.order_id === orderData.order_id);
      if (exists) {
        return prev.map((order) =>
          order.order_id === orderData.order_id ? orderData : order
        );
      }
      return [...prev, orderData];
    });

    setOrders((prev) => {
      const existing = prev.find((order) => order.order_id === orderData.order_id);
      const mapped = mapOrderToSummary(orderData, existing);
      if (!mapped) {
        return prev.filter((order) => order.order_id !== orderData.order_id);
      }
      if (existing) {
        return prev.map((order) => (order.order_id === mapped.order_id ? mapped : order));
      }
      return [...prev, mapped];
    });
  };

  const markOrderReadyLocally = (orderId: string) => {
    const nextStatusStartedAt = new Date().toISOString();

    setOrdersRaw((prev) =>
      prev.map((order) =>
        order.order_id === orderId ? { ...order, order_status: "ready" } : order
      )
    );

    setOrders((prev) =>
      prev.map((order) =>
        order.order_id === orderId
          ? { ...order, order_status: "ready", status_started_at: nextStatusStartedAt }
          : order
      )
    );
  };

  useEffect(() => {
    if (!isMounted) return;
    setOrdersRaw([]);
    setOrders([]);
    setSelectedOrderId(null);
    setNewOrdersCount(0);
    setLastNotifiedOrderId(null);
    setSoundTriggerId(null);
    pendingUpdateRef.current.forEach((timeout) => clearTimeout(timeout));
    pendingUpdateRef.current.clear();

    if (!businessLocationId) return;
    void fetchOrders(businessLocationId);
  }, [businessLocationId, isMounted]);

  useEffect(() => {
    if (!businessLocationId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let uberChannel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      supabase.realtime.setAuth(token);

      channel = supabase
        .channel(`orders-realtime-${businessLocationId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "mediasis",
            table: "orders",
            filter: `business_location_id=eq.${businessLocationId}`,
          },
          async (payload: {
            new: {
              order_id: string;
              products_payment_status: string | null;
              delivery_payment_status: string | null;
              order_status: string | null;
            };
          }) => {
            try {
              if (activeLocationIdRef.current !== businessLocationId) return;
              const updatedOrder = payload.new as {
                order_id: string;
                products_payment_status: string | null;
                delivery_payment_status: string | null;
                order_status: string | null;
              };

              if (updatedOrder.order_status === "ready") {
                markOrderReadyLocally(updatedOrder.order_id);
                return;
              }

              if (
                updatedOrder.products_payment_status !== "paid" &&
                updatedOrder.delivery_payment_status !== "paid"
              ) {
                return;
              }

              const response = await fetchOneOrder(
                supabase,
                updatedOrder.order_id,
                businessLocationId
              );

              if (activeLocationIdRef.current !== businessLocationId) return;
              if (!response?.success || !response.data) return;
              const orderData = response.data as OrderRealtimeOrder;

              const alreadyInList = ordersRawRef.current.some(
                (order) => order.order_id === orderData.order_id
              );
              if (!alreadyInList) {
                setNewOrdersCount((count) => count + 1);
                setLastNotifiedOrderId(orderData.order_id);
                setSoundTriggerId(`${orderData.order_id}-${Date.now()}`);
              }

              upsertRealtimeOrder(orderData);
            } catch (err) {
              console.error("orders realtime callback error", err);
            }
          }
        )
        .subscribe((status: string) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error("orders realtime channel status:", status);
          }
        });

      uberChannel = supabase
        .channel(`uber-deliveries-realtime-${businessLocationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "mediasis",
            table: "uber_deliveries",
            filter: `business_location_id=eq.${businessLocationId}`,
          },
          (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
            const row = (payload.new ?? payload.old) as { order_id?: string } | null;
            if (!row?.order_id) return;

            const isTracked = ordersRawRef.current.some(
              (o) => o.order_id === row.order_id
            );
            if (!isTracked) return;

            const orderId = row.order_id;
            const existing = pendingUpdateRef.current.get(orderId);
            if (existing) clearTimeout(existing);
            pendingUpdateRef.current.set(
              orderId,
              setTimeout(async () => {
                pendingUpdateRef.current.delete(orderId);
                try {
                  if (activeLocationIdRef.current !== businessLocationId) return;
                  const response = await fetchOneOrder(supabase, orderId, businessLocationId);
                  if (activeLocationIdRef.current !== businessLocationId) return;
                  if (!response?.success || !response.data) return;
                  upsertRealtimeOrder(response.data as OrderRealtimeOrder);
                } catch (err) {
                  console.error("uber-deliveries realtime callback error", err);
                }
              }, 300)
            );
          }
        )
        .subscribe((status: string) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error("uber-deliveries realtime channel status:", status);
          }
        });
    })();

    return () => {
      pendingUpdateRef.current.forEach((timeout) => clearTimeout(timeout));
      pendingUpdateRef.current.clear();
      if (channel) supabase.removeChannel(channel);
      if (uberChannel) supabase.removeChannel(uberChannel);
    };
  }, [businessLocationId, getAccessToken, supabase]);

  useEffect(() => {
    const rebindRealtimeFromSession = async () => {
      const token = await getAccessToken();
      if (token) {
        supabase.realtime.setAuth(token);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        // Avoid bursty rebind attempts when users switch tabs quickly.
        if (now - lastVisibilityRebindRef.current < 60_000) return;
        lastVisibilityRebindRef.current = now;
        void rebindRealtimeFromSession();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [getAccessToken, supabase]);

  const total = orders.length;
  const handleSelectOrder = (order: OrderSummary) => {
    setSelectedOrderId(order.order_id);
  };

  const finalizeStatusUpdate = async (orderId: string, nextStatus: "preparing" | "ready") => {
    // Do not route this through a server action: this Supabase client already
    // carries the current legacy or Clerk token, and the database RLS policy
    // enforces both orders.manage.full and the assigned location scope.
    const { error } = await supabase
      .schema("mediasis")
      .from("orders")
      .update({ order_status: nextStatus })
      .eq("order_id", orderId);
    if (error) {
      toast.error("No se pudo actualizar el estado del pedido");
    }
  };

  const handleChangeStatus = (order: OrderSummary, nextStatus: "preparing" | "ready") => {
    const existingTimeout = pendingUpdateRef.current.get(order.order_id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      pendingUpdateRef.current.delete(order.order_id);
    }

    lastMoveRef.current = {
      orderId: order.order_id,
      previousStatus: order.order_status,
      previousStatusStartedAt: order.status_started_at,
      nextStatus,
    };

    const nextStatusStartedAt = new Date().toISOString();

    setOrders((prev) =>
      prev.map((item) =>
        item.order_id === order.order_id
          ? { ...item, order_status: nextStatus, status_started_at: nextStatusStartedAt }
          : item
      )
    );

    setOrdersRaw((prev) =>
      prev.map((item) =>
        item.order_id === order.order_id ? { ...item, order_status: nextStatus } : item
      )
    );

    const toastId = toast(
      nextStatus === "preparing"
        ? "Pedido movido a Preparando"
        : "Pedido movido a Listo",
      {
        duration: 5000,
        action: {
          label: "Deshacer",
          onClick: () => {
            const lastMove = lastMoveRef.current;
            if (!lastMove || lastMove.orderId !== order.order_id) return;
            const pendingTimeout = pendingUpdateRef.current.get(lastMove.orderId);
            if (pendingTimeout) {
              clearTimeout(pendingTimeout);
              pendingUpdateRef.current.delete(lastMove.orderId);
            }

            setOrders((prev) =>
              prev.map((item) =>
                item.order_id === lastMove.orderId
                  ? {
                      ...item,
                      order_status: lastMove.previousStatus,
                      status_started_at: lastMove.previousStatusStartedAt,
                    }
                  : item
              )
            );

            setOrdersRaw((prev) =>
              prev.map((item) =>
                item.order_id === lastMove.orderId
                  ? { ...item, order_status: lastMove.previousStatus }
                  : item
              )
            );

            lastMoveRef.current = null;
            toast.dismiss(toastId);
          },
        },
      }
    );

    const timeoutId = setTimeout(() => {
      finalizeStatusUpdate(order.order_id, nextStatus);
      pendingUpdateRef.current.delete(order.order_id);
      const lastMove = lastMoveRef.current;
      if (lastMove?.orderId === order.order_id) {
        lastMoveRef.current = null;
      }
    }, 5000);

    pendingUpdateRef.current.set(order.order_id, timeoutId);
  };

  const handleClearReady = () => {
    setOrders((prev) => prev.filter((order) => order.order_status !== "ready"));
    setOrdersRaw((prev) => prev.filter((order) => order.order_status !== "ready"));
    if (selectedOrderId) {
      const selectedIsReady = orders.find((order) => order.order_id === selectedOrderId)?.order_status === "ready";
      if (selectedIsReady) setSelectedOrderId(null);
    }
  };

  const selectedOrder = ordersRaw.find((item) => item.order_id === selectedOrderId) ?? null;
  const selectedSummary = orders.find((item) => item.order_id === selectedOrderId) ?? null;

  return (
    <div className="px-4 py-3 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-base font-semibold">Pedidos en tiempo real</h1>
          </div>
          <NotificationsControl
            enabled={notificationsEnabled}
            onRequestPermission={requestNotificationPermission}
          />
          <RealtimeSoundControl triggerId={soundTriggerId} />
        </div>
        <Badge variant="secondary">{total}</Badge>
      </div>

      <OrdersDesktopBoard
        orders={orders}
        now={now}
        onSelect={handleSelectOrder}
        onChangeStatus={handleChangeStatus}
        onClearReady={handleClearReady}
      />
      <OrdersMobileTabs
        orders={orders}
        now={now}
        onSelect={handleSelectOrder}
        onChangeStatus={handleChangeStatus}
      />

      <OrderDetailSheet
        open={Boolean(selectedOrderId)}
        onOpenChange={(open) => !open && setSelectedOrderId(null)}
        order={selectedOrder}
        summary={selectedSummary}
      />

      <NotificationsManager
        enabled={notificationsEnabled}
        count={newOrdersCount}
        triggerId={lastNotifiedOrderId}
        title="Nuevo pedido"
        body="Tienes un nuevo pedido en tiempo real."
      />
    </div>
  );
}
