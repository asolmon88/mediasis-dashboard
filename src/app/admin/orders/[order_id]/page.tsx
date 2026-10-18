import MainPage from "@/components/app/orders/order-id/MainPage";
import { createClient } from "@/lib/supabase/server";
import { OrderDetailResponse } from "@/lib/types/dashboardTypes";
import { getOrderRefunds } from "./actions";
import { DashboardAccessDenied } from "@/components/dashboard/DashboardAccessDenied";
import { requireOrderAccess } from "@/lib/dashboard/order-authorization";

type OrderDetailPageProps = {
  params: Promise<{ order_id: string }>;
};

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { order_id } = await params;
  const authorized = await requireOrderAccess(order_id);
  if (!authorized.success) {
    return <DashboardAccessDenied title="Pedido no disponible" description={authorized.message} />;
  }
  if (!authorized.context.market) {
    return <DashboardAccessDenied title="Pedido no disponible" description="No se pudo resolver la configuración regional del negocio." />;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("mediasis")
    .rpc("get_order_detail", { p_order_id: order_id });

  if (error) {
    return (
      <div className="px-4 py-4">
        <p className="text-sm text-muted-foreground">
          Error al cargar el pedido.
        </p>
      </div>
    );
  }

  const response = data as OrderDetailResponse | null;
  if (!response?.success || !response.data) {
    return (
      <div className="px-4 py-4">
        <p className="text-sm text-muted-foreground">
          {response?.message ?? "No hay informacion del pedido."}
        </p>
      </div>
    );
  }

  // Fetch delivery method flags for cancel logic (not returned by get_order_detail RPC)
  let requireCourier = false;
  let requireLocation = false;
  const { data: orderMeta } = await authorized.admin
    .schema("mediasis")
    .from("orders")
    .select("delivery_method, service_fee")
    .eq("order_id", order_id)
    .maybeSingle();
  if (orderMeta?.delivery_method) {
    const { data: flags } = await authorized.admin
      .schema("mediasis")
      .from("delivery_methods_business")
      .select("require_courier, require_location")
      .eq("uid", orderMeta.delivery_method)
      .maybeSingle();
    requireCourier = (flags as { require_courier?: boolean } | null)?.require_courier ?? false;
    requireLocation = (flags as { require_location?: boolean } | null)?.require_location ?? false;
  }

  const detail = {
    ...response.data,
    order: {
      ...response.data.order,
      delivery_price:
        Number(response.data.order.delivery_price ?? 0) + Number(orderMeta?.service_fee ?? 0),
    },
  };

  const refunds = await getOrderRefunds(order_id);

  return (
    <MainPage
      detail={detail}
      requireCourier={requireCourier}
      requireLocation={requireLocation}
      refunds={refunds}
      market={authorized.context.market}
      paymentProvider={authorized.order.payment_provider}
    />
  );
}
