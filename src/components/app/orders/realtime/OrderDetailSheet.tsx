"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  calculateRealtimeItemLineTotal,
  formatCurrencyValue,
  normalizeExternalUrl,
  formatOrderOptions,
  formatProductOptions,
} from "@/lib/utils";
import { OrderRealtimeOrder, OrderSummary, UberDelivery } from "@/lib/types/dashboardTypes";
import { ExternalLink, MapPin, Phone, ReceiptText, Truck, X } from "lucide-react";
import { OrderReadyTimeControl } from "./OrderReadyTimeControl";
import { createUberDeliveryAction } from "@/app/admin/orders/realtime/actions";
import { toast } from "sonner";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

type OrderDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderRealtimeOrder | null;
  summary: OrderSummary | null;
};

function formatTimestamp(iso: string | null | undefined, locale: string, timeZone: string): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

const orderStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  new: "Nuevo",
  preparing: "Preparando",
  ready: "Listo",
  accepted: "Aceptado",
  delivered: "Entregado",
};

const uberStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  pickup: "Recogiendo",
  pickup_complete: "Recogido",
  dropoff: "En camino",
  delivered: "Entregado",
  canceled: "Cancelado",
  returned: "Devuelto",
};

function OrderStatusBadge({ status }: { status: string }) {
  const label = orderStatusLabels[status] ?? status;
  const classMap: Record<string, string> = {
    pending: "bg-gray-100 text-gray-700 border-gray-200",
    new: "bg-gray-100 text-gray-700 border-gray-200",
    preparing: "bg-yellow-100 text-yellow-800 border-yellow-200",
    ready: "bg-green-100 text-green-800 border-green-200",
    accepted: "bg-green-100 text-green-800 border-green-200",
    delivered: "bg-green-100 text-green-800 border-green-200",
  };
  return (
    <Badge variant="outline" className={classMap[status] ?? "bg-gray-100 text-gray-700 border-gray-200"}>
      {label}
    </Badge>
  );
}

function UberStatusBadge({ status, role }: { status: string | null; role?: string }) {
  if (!status) return null;
  const label = uberStatusLabels[status] ?? status;
  const classMap: Record<string, string> = {
    pending: "bg-gray-100 text-gray-700 border-gray-200",
    pickup: "bg-blue-100 text-blue-800 border-blue-200",
    pickup_complete: "bg-blue-100 text-blue-800 border-blue-200",
    dropoff: "bg-indigo-100 text-indigo-800 border-indigo-200",
    delivered: "bg-green-100 text-green-800 border-green-200",
    canceled: "bg-red-100 text-red-800 border-red-200",
    returned: "bg-orange-100 text-orange-800 border-orange-200",
  };
  const isReturn = role === "return" || role === "replacement";
  return (
    <Badge variant="outline" className={classMap[status] ?? "bg-gray-100 text-gray-700"}>
      {isReturn ? "↩ " : ""}{label}
    </Badge>
  );
}

function TimelineRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function CallUberButton({ orderId, hasExisting }: { orderId: string; hasExisting: boolean }) {
  const [isPending, startTransition] = useTransition();
  const label = hasExisting ? "Re-solicitar Uber" : "Llamar Uber";

  const handleClick = () => {
    startTransition(async () => {
      const result = await createUberDeliveryAction(orderId);
      if (!result.success) {
        toast.error(result.message ?? "No se pudo solicitar el courier");
        return;
      }
      toast.success("Courier solicitado");
    });
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
      <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">
          {hasExisting ? "El delivery anterior falló o fue cancelado." : "Sin delivery asignado."}
        </p>
      </div>
      <Button size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? "Solicitando..." : label}
      </Button>
    </div>
  );
}

function IntegrationErrorBanner({ uber }: { uber: UberDelivery }) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  if (!uber.integration_error) return null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 space-y-0.5">
      <p className="text-xs font-semibold text-red-700">Error de integración con Uber</p>
      <p className="text-xs text-red-600">{uber.integration_error}</p>
      {uber.integration_error_at && (
        <p className="text-xs text-red-400">{formatTimestamp(uber.integration_error_at, market.locale, market.timezone)}</p>
      )}
    </div>
  );
}

function UberDirectSection({ uber, deliveryId }: { uber: UberDelivery; deliveryId?: string | null }) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const uberId = uber.uber_id_last5 ?? uber.uber_uuid?.slice(-5) ?? null;
  const isReturn = uber.delivery_role === "return" || deliveryId?.startsWith("ret_");
  const hasCourier = uber.courier_name || uber.courier_vehicle_model || uber.courier_vehicle_color;
  const hasTimestamps =
    uber.pickup_eta ||
    uber.pickup_ready ||
    uber.pickup_deadline ||
    uber.pickup_completed_at ||
    uber.dropoff_eta ||
    uber.dropoff_deadline ||
    uber.delivered_at;
  const hasAddresses = uber.pickup_address || uber.dropoff_address;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Truck className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Uber</span>
        </div>
        <UberStatusBadge status={uber.status} role={uber.delivery_role} />
        {isReturn && (
          <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">
            Devolución
          </Badge>
        )}
        {uber.courier_imminent && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full border border-orange-200">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
            Courier en camino
          </span>
        )}
      </div>

      <IntegrationErrorBanner uber={uber} />

      {uberId && (
        <p className="text-xs text-muted-foreground">
          Uber ID: <span className="font-mono font-medium text-foreground">{uberId}</span>
        </p>
      )}

      {hasCourier && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-3">
            {uber.courier_img_href ? (
              <img
                src={uber.courier_img_href}
                alt={uber.courier_name ?? "Courier"}
                className="h-10 w-10 rounded-full object-cover border shrink-0"
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-muted border flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-muted-foreground">
                  {uber.courier_name?.charAt(0) ?? "?"}
                </span>
              </div>
            )}
            <div className="min-w-0">
              {uber.courier_name && (
                <p className="text-sm font-medium truncate">{uber.courier_name}</p>
              )}
              {uber.courier_phone_number && (
                <a
                  href={`tel:${uber.courier_phone_number}`}
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <Phone className="h-3 w-3" />
                  {uber.courier_phone_number}
                </a>
              )}
            </div>
          </div>
          {(uber.courier_vehicle_color || uber.courier_vehicle_model || uber.courier_vehicle_make || uber.courier_vehicle_type) && (
            <div className="text-xs text-muted-foreground space-y-0.5 pt-1 border-t">
              {(uber.courier_vehicle_color || uber.courier_vehicle_model) && (
                <p>
                  {[uber.courier_vehicle_color, uber.courier_vehicle_make, uber.courier_vehicle_model]
                    .filter(Boolean)
                    .join(" ")}
                </p>
              )}
              {uber.courier_vehicle_type && (
                <p className="capitalize">{uber.courier_vehicle_type}</p>
              )}
              {uber.courier_vehicle_license_plate && (
                <p>Placa: <span className="font-medium text-foreground">{uber.courier_vehicle_license_plate}</span></p>
              )}
            </div>
          )}
        </div>
      )}

      {hasTimestamps && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tiempos</p>
          <div className="space-y-1">
            <TimelineRow label="ETA recogida" value={formatTimestamp(uber.pickup_eta, market.locale, market.timezone)} />
            <TimelineRow label="Recogida lista desde" value={formatTimestamp(uber.pickup_ready, market.locale, market.timezone)} />
            <TimelineRow label="Límite recogida" value={formatTimestamp(uber.pickup_deadline, market.locale, market.timezone)} />
            <TimelineRow label="Recogida completada" value={formatTimestamp(uber.pickup_completed_at, market.locale, market.timezone)} />
            <TimelineRow label="ETA entrega" value={formatTimestamp(uber.dropoff_eta, market.locale, market.timezone)} />
            <TimelineRow label="Límite entrega" value={formatTimestamp(uber.dropoff_deadline, market.locale, market.timezone)} />
            <TimelineRow label="Entregado" value={formatTimestamp(uber.delivered_at, market.locale, market.timezone)} />
          </div>
        </div>
      )}

      {hasAddresses && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Direcciones</p>
          <div className="space-y-2">
            {uber.pickup_address && (
              <div className="flex items-start gap-2 text-xs">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <span className="text-muted-foreground">Recogida: </span>
                  <span>{uber.pickup_address}</span>
                </div>
              </div>
            )}
            {uber.dropoff_address && (
              <div className="flex items-start gap-2 text-xs">
                <MapPin className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <span className="text-muted-foreground">Entrega: </span>
                  <span>{uber.dropoff_address}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

function ProofSection({ uber }: { uber: UberDelivery }) {
  const hasProof = uber.proof_picture_url || uber.signature_image_url || uber.cancellation_reason || uber.undeliverable_reason;
  if (!hasProof) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Comprobante</h3>
      {uber.proof_picture_url && (
        <a href={uber.proof_picture_url} target="_blank" rel="noreferrer" className="block">
          <img
            src={uber.proof_picture_url}
            alt="Foto de entrega"
            className="rounded-md border max-h-48 object-cover w-full"
          />
          <span className="text-xs text-blue-600 hover:underline mt-1 inline-block">Ver foto completa</span>
        </a>
      )}
      {uber.signature_image_url && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Firma</p>
          <a href={uber.signature_image_url} target="_blank" rel="noreferrer" className="block">
            <img
              src={uber.signature_image_url}
              alt="Firma"
              className="rounded-md border max-h-24 object-contain bg-white"
            />
          </a>
          {uber.signature_signer_name && (
            <p className="text-xs text-muted-foreground">Firmó: <span className="text-foreground font-medium">{uber.signature_signer_name}</span></p>
          )}
          {uber.signature_signer_relationship && (
            <p className="text-xs text-muted-foreground">Relación: <span className="text-foreground">{uber.signature_signer_relationship}</span></p>
          )}
        </div>
      )}
      {uber.cancellation_reason && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs font-medium text-red-700">Motivo de cancelación</p>
          <p className="text-xs text-red-600 mt-0.5">{uber.cancellation_reason}</p>
        </div>
      )}
      {uber.undeliverable_reason && (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
          <p className="text-xs font-medium text-orange-700">No entregado</p>
          <p className="text-xs text-orange-600 mt-0.5">{uber.undeliverable_reason}</p>
          {uber.undeliverable_action && (
            <p className="text-xs text-orange-600">Acción: {uber.undeliverable_action}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function OrderDetailSheet({
  open,
  onOpenChange,
  order,
  summary,
}: OrderDetailSheetProps) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const formatMoney = (value: number) => new Intl.NumberFormat(market.locale, { style: "currency", currency: market.currencyCode }).format(value);
  const formatAmount = (value: number | null | undefined) => formatCurrencyValue(value, formatMoney);
  const receiptUrl = normalizeExternalUrl(order?.receipt_url);
  const trackingUrl = normalizeExternalUrl(summary?.tracking_link ?? order?.tracking_link);
  const productsPrice =
    typeof order?.products_price === "number" && Number.isFinite(order.products_price)
      ? order.products_price
      : null;
  const deliveryPrice =
    typeof order?.delivery_price === "number" && Number.isFinite(order.delivery_price)
      ? order.delivery_price
      : null;
  const hasDeliveryPrice = typeof deliveryPrice === "number" && deliveryPrice > 0;
  const visibleTotalPrice =
    typeof productsPrice === "number" ? productsPrice + (hasDeliveryPrice ? deliveryPrice : 0) : null;

  const uber = order?.uber_delivery ?? null;
  const orderOptions = order ? formatOrderOptions(order.order_options, formatMoney) : [];
  const canCallUber =
    order?.delivery_method?.require_courier &&
    (!uber ||
      uber.status === "canceled" ||
      uber.status === "returned" ||
      !!uber.integration_error);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 p-0 sm:max-w-2xl max-h-[90dvh] overflow-hidden"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b shrink-0">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <DialogTitle className="text-base">
                {order?.human_order_number
                  ? `Pedido #${order.human_order_number}`
                  : "Detalle del pedido"}
              </DialogTitle>
              {order && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Pedido:</span>
                  <OrderStatusBadge status={order.order_status} />
                </span>
              )}
              {uber?.status && (
                <span className="inline-flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Uber:</span>
                  <UberStatusBadge status={uber.status} role={uber.delivery_role} />
                </span>
              )}
            </div>
            {order?.created_at && (
              <p className="text-xs text-muted-foreground">{formatTimestamp(order.created_at, market.locale, market.timezone)}</p>
            )}
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="shrink-0 -mr-2 -mt-1 h-8 w-8">
              <X className="h-4 w-4" />
              <span className="sr-only">Cerrar</span>
            </Button>
          </DialogClose>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 py-4 flex flex-col gap-5">
            <OrderReadyTimeControl order={order} />

            {order && <Separator />}

            {/* Operational summary */}
            {order && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Resumen</h3>
                <div className="text-sm space-y-1">
                  <p className="font-medium">
                    {order.client.first_name} {order.client.last_name}
                  </p>
                  {order.client.phone_number && (
                    <a
                      href={`tel:${order.client.phone_number}`}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <Phone className="h-3 w-3" />
                      {order.client.phone_number}
                    </a>
                  )}
                  {order.client.email && (
                    <p className="text-xs text-muted-foreground">{order.client.email}</p>
                  )}
                  <p className="text-xs text-muted-foreground pt-1">
                    {order.delivery_method?.name ?? "Sin método de delivery"}
                  </p>
                </div>
                {(receiptUrl || trackingUrl) && (
                  <div className="flex flex-wrap gap-2">
                    {receiptUrl && (
                      <Button asChild size="sm" variant="outline">
                        <a href={receiptUrl} target="_blank" rel="noreferrer">
                          <ReceiptText className="h-4 w-4" />
                          Ver recibo
                        </a>
                      </Button>
                    )}
                    {trackingUrl && (
                      <Button asChild size="sm" variant="ghost">
                        <a href={trackingUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4" />
                          Rastrear pedido
                        </a>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Products */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Productos</h3>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Total productos: {formatAmount(productsPrice)}</p>
                {hasDeliveryPrice && (
                  <>
                    <p>Delivery: {formatAmount(deliveryPrice)}</p>
                    <p className="font-medium text-foreground">
                      Total: {formatAmount(visibleTotalPrice)}
                    </p>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-4">
                {order?.items?.map((item, index) => {
                  const productOptions = formatProductOptions(item.options, formatMoney);
                  const itemLineTotal = calculateRealtimeItemLineTotal(
                    item.total_price,
                    item.quantity,
                    item.options
                  );
                  return (
                    <div key={`${item.product_variant_name}-${index}`} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {item.image ? (
                            <img
                              src={item.image}
                              alt={item.product_variant_name}
                              className="h-10 w-10 rounded-md object-cover shrink-0"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-md border bg-muted/20 shrink-0" />
                          )}
                          <div>
                            <p className="text-sm font-medium">{item.product_variant_name}</p>
                            <p className="text-xs text-muted-foreground">Cantidad: {item.quantity}</p>
                          </div>
                        </div>
                        <span className="text-sm font-semibold shrink-0">
                          {formatAmount(itemLineTotal)}
                        </span>
                      </div>
                      {productOptions.length > 0 && (
                        <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-2">
                          {productOptions.map((option) => (
                            <li key={`${option.label}-${option.values.join("-")}`} className="space-y-1">
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
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Order options */}
            {orderOptions.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Opciones del pedido</h3>
                  <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-1">
                    {orderOptions.map((option, index) => (
                      <li
                        key={
                          option.type === "text"
                            ? `${option.label}-${option.value}-${index}`
                            : `${option.label}-${option.mediaUrl}-${index}`
                        }
                        className="space-y-2"
                      >
                        <span className="block">{option.label}</span>
                        {option.type === "text" && (
                          <span className="block font-semibold text-foreground">{option.value}</span>
                        )}
                        {option.type === "media" && (
                          <a
                            href={option.mediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 text-blue-600 hover:underline"
                          >
                            <img
                              src={option.mediaUrl}
                              alt={option.label}
                              className="h-10 w-10 rounded-md object-cover border"
                            />
                            Ver imagen
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {order?.discount_breakdown && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Descuento aplicado</h3>
                  <p className="text-xs text-muted-foreground">
                    {order.discount_breakdown.title} ({order.discount_breakdown.code})
                  </p>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Subtotal antes del descuento</span>
                      <span>{formatAmount(order.discount_breakdown.order_total_before_discount)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Descuento</span>
                      <span className="text-emerald-600">
                        -{formatAmount(order.discount_breakdown.discount_amount)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between font-semibold">
                      <span>Total final</span>
                      <span>{formatAmount(order.discount_breakdown.order_total_after_discount)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Call Uber — no delivery assigned */}
            {canCallUber && !uber && order && (
              <>
                <Separator />
                <CallUberButton orderId={order.order_id} hasExisting={false} />
              </>
            )}

            {/* Uber Direct */}
            {uber && (
              <>
                <Separator />
                <UberDirectSection uber={uber} deliveryId={order?.uber_delivery_id} />
              </>
            )}

            {/* Re-solicitar Uber — failed/cancelled delivery */}
            {canCallUber && uber && order && (
              <CallUberButton orderId={order.order_id} hasExisting={true} />
            )}

            {/* Proof / exceptions */}
            {uber && <ProofSection uber={uber} />}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t shrink-0 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
