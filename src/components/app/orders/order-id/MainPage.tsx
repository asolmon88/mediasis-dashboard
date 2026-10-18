import { OrderDetailResponse } from "@/lib/types/dashboardTypes";
import { ProductsDetailsCard } from "./ProductsDetailsCard";
import { ClientDetailsCard } from "./ClientDetailsCard";
import { PaymentDetailsCard } from "./PaymentDetailsCard";
import { OnvoDetailsCard } from "./OnvoDetailsCard";
import { TrackingDetailsCard } from "./TrackingDetailsCard";
import { CancelOrderButton } from "./CancelOrderButton";
import { RefundDetailsCard } from "./RefundDetailsCard";
import type { OrderRefundRecord } from "@/app/admin/orders/[order_id]/actions";
import { mapOrderStatusToSpanish } from "@/lib/orders/utils";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { normalizeExternalUrl } from "@/lib/utils";
import { ReceiptText } from "lucide-react";
import type { BusinessMarket } from "@/lib/dashboard/auth-types";

type OrderDetailMainPageProps = {
  detail: OrderDetailResponse["data"] | null;
  requireCourier: boolean;
  requireLocation: boolean;
  refunds: OrderRefundRecord[];
  market: BusinessMarket;
  paymentProvider: string | null;
};

const formatDate = (value: string, market: BusinessMarket) =>
  new Date(value).toLocaleString(market.locale, {
    timeZone: market.timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function MainPage({ detail, requireCourier, requireLocation, refunds, market, paymentProvider }: OrderDetailMainPageProps) {
  if (!detail?.order) {
    return (
      <div className="px-4 py-3">
        <p className="text-sm text-muted-foreground">No hay informacion del pedido.</p>
      </div>
    );
  }

  const order = detail.order;
  const items = detail.items ?? [];
  const receiptUrl = normalizeExternalUrl(order.receipt_url);

  const hasActiveUber = requireCourier && requireLocation && !!detail?.active_uber_delivery;
  const normalizedPaymentMethod = (order.payment_method_name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const isSinpePayment = normalizedPaymentMethod.includes("sinpe");
  const canRefund =
    !["cancelled", "delivered"].includes(order.order_status ?? "") &&
    (isSinpePayment || !!order.products_payment_intent_id) &&
    order.products_payment_status !== "refunded";
  const canPartiallyRefundTilopay =
    paymentProvider === "tilopay" &&
    !!order.products_payment_intent_id &&
    order.products_payment_status === "paid";
  const canManageOrder = hasActiveUber || canRefund || canPartiallyRefundTilopay;

  return (
    <div className="px-4 py-4 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <BackButton label="Volver a ordenes" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">
            #{order.human_order_number} {order.client?.first_name ?? ""} {order.client?.last_name ?? ""}
            </h1>
            {order.order_status ? (
              <span className="text-xs text-muted-foreground">
                {mapOrderStatusToSpanish(order.order_status)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {receiptUrl ? (
              <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                <a href={receiptUrl} target="_blank" rel="noreferrer">
                  <ReceiptText className="h-4 w-4" />
                  Ver recibo
                </a>
              </Button>
            ) : null}
            {canManageOrder && (
              <CancelOrderButton
                orderId={order.order_id}
                requiresUberCancel={hasActiveUber}
                canRefundPayment={canRefund}
                isPickupOrder={!requireCourier}
                isSinpePayment={isSinpePayment}
                canPartiallyRefundTilopay={canPartiallyRefundTilopay}
              />
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground break-all">
          UUID: {order.order_id}
        </p>
        <p className="text-sm text-muted-foreground">
          {formatDate(order.created_at, market)}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <ProductsDetailsCard
            items={items}
            productsPrice={order.products_price}
            discountBreakdown={order.discount_breakdown ?? null}
          />
          <PaymentDetailsCard
            paymentMethodName={order.payment_method_name}
            productsPrice={order.products_price}
            deliveryPrice={order.delivery_price}
            productsPaymentStatus={order.products_payment_status}
            deliveryPaymentStatus={order.delivery_payment_status}
            discountBreakdown={order.discount_breakdown ?? null}
          />
          <TrackingDetailsCard
            deliveryMethodName={order.delivery_method_name}
            trackingLink={order.tracking_link}
            dropOffLat={order.drop_off_lat}
            dropOffLng={order.drop_off_lng}
            options={order.options}
          />
          <OnvoDetailsCard
            productsPaymentIntentId={order.products_payment_intent_id}
            deliveryPaymentIntentId={order.delivery_payment_intent_id}
          />
        </div>
        <div className="flex flex-col gap-4">
          <ClientDetailsCard client={order.client} />
          <RefundDetailsCard refunds={refunds} />
        </div>
      </div>
    </div>
  );
}
