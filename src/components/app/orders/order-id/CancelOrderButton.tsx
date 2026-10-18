"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cancelOrderAction } from "@/app/admin/orders/[order_id]/actions";

type Props = {
  orderId: string;
  requiresUberCancel: boolean;
  canRefundPayment: boolean;
  isPickupOrder: boolean;
  isSinpePayment: boolean;
  canPartiallyRefundTilopay: boolean;
};

const UBER_CANCEL_REASONS: { value: string; label: string }[] = [
  { value: "out_of_items",                        label: "Productos agotados" },
  { value: "store_closed",                        label: "Tienda cerrada" },
  { value: "customer_called_to_cancel",           label: "Cliente solicitó cancelar" },
  { value: "store_too_busy",                      label: "Tienda muy ocupada" },
  { value: "courier_delayed_en_route_to_pickup",  label: "Repartidor con retraso en recogida" },
  { value: "too_expensive",                       label: "Costo muy elevado" },
  { value: "customer_changed_order_requirements", label: "Cliente cambió los requisitos" },
  { value: "delivery_vehicle_too_small",          label: "Vehículo del repartidor muy pequeño" },
  { value: "no_courier_assigned",                 label: "Sin repartidor asignado" },
  { value: "other",                               label: "Otro" },
];

export function CancelOrderButton({
  orderId,
  requiresUberCancel,
  canRefundPayment,
  isPickupOrder,
  isSinpePayment,
  canPartiallyRefundTilopay,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [additionalDescription, setAdditionalDescription] = useState("");
  const [cancelUber, setCancelUber] = useState(false);
  const [refundProducts, setRefundProducts] = useState(false);
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [partialRefundAmount, setPartialRefundAmount] = useState("");
  const [sinpeRefundAcknowledged, setSinpeRefundAcknowledged] = useState(false);
  const [paidOutRefundAcknowledged, setPaidOutRefundAcknowledged] = useState(false);
  const [requiresManualPaidOutRefund, setRequiresManualPaidOutRefund] = useState(false);

  const isOther = reason === "other";
  const canConfirm =
    !isPending &&
    (cancelUber || refundProducts) &&
    (!cancelUber || (reason !== "" && (!isOther || additionalDescription.trim() !== ""))) &&
    (!refundProducts || !isSinpePayment || sinpeRefundAcknowledged) &&
    (!refundProducts || refundType !== "partial" || /^\d+(?:[.,]\d+)?$/.test(partialRefundAmount.trim())) &&
    (!requiresManualPaidOutRefund || paidOutRefundAcknowledged);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen && !isPending) {
      setCancelUber(false);
      setRefundProducts(false);
      setRefundType("full");
      setPartialRefundAmount("");
      setSinpeRefundAcknowledged(false);
      setPaidOutRefundAcknowledged(false);
      setRequiresManualPaidOutRefund(false);
      setReason("");
      setAdditionalDescription("");
    }
  };

  const handleConfirm = () => {
    startTransition(async () => {
      const result = await cancelOrderAction(orderId, {
        cancelUber,
        refundProducts,
        refundType: refundProducts ? refundType : undefined,
        partialRefundAmount: refundProducts && refundType === "partial"
          ? partialRefundAmount.trim()
          : undefined,
        sinpeRefundAcknowledged: isSinpePayment
          ? sinpeRefundAcknowledged
          : undefined,
        paidOutRefundAcknowledged: requiresManualPaidOutRefund
          ? paidOutRefundAcknowledged
          : undefined,
        cancelationReason: cancelUber ? reason : undefined,
        additionalDescription:
          cancelUber && additionalDescription.trim()
            ? additionalDescription.trim()
            : undefined,
      });
      if (!result.success) {
        if (result.refund.requiresManualRefundConfirmation) {
          setRequiresManualPaidOutRefund(true);
          setPaidOutRefundAcknowledged(false);
          setCancelUber(false);
          setRefundProducts(true);
          toast.warning(result.refund.message);
          router.refresh();
          return;
        }
        toast.error(result.message ?? "No se pudo cancelar el pedido");
        router.refresh();
        return;
      }
      toast.success(result.message ?? "Operación completada");
      handleOpenChange(false);
      router.refresh();
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" className="w-full sm:w-auto">
          Acciones del pedido
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isPickupOrder ? "¿Reembolsar y cancelar este pedido?" : "¿Qué acción deseas realizar?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1">
              {isPickupOrder ? (
                <p>
                  {isSinpePayment
                    ? "Confirma que realizaste manualmente el reembolso de SINPE antes de cancelar el pedido."
                    : "Se procesará el reembolso del pago y, cuando sea exitoso, se cancelará el pedido."}
                </p>
              ) : (
                <>
                  <p>Selecciona una o ambas acciones. Ninguna está seleccionada por defecto.</p>
                  <p>
                    Un reembolso confirmado cancelará el pedido. Cancelar solo Uber mantendrá el pedido activo.
                  </p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          {requiresUberCancel && (
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <Checkbox
                checked={cancelUber}
                onCheckedChange={(checked) => setCancelUber(checked === true)}
                aria-label="Cancelar delivery de Uber"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">Cancelar delivery de Uber</span>
                <span className="block text-xs text-muted-foreground">
                  El pedido seguirá activo para poder solicitar otro courier.
                </span>
              </span>
            </label>
          )}
          {canRefundPayment && (
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <Checkbox
                checked={refundProducts && refundType === "full"}
                onCheckedChange={(checked) => {
                  setRefundProducts(checked === true);
                  if (checked === true) setRefundType("full");
                }}
                aria-label="Reembolsar pago de productos"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">
                  {isSinpePayment
                    ? "Cancelar pedido con reembolso manual de SINPE"
                    : isPickupOrder
                      ? "Reembolsar pago y cancelar pedido"
                      : "Reembolsar pago de productos"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {isSinpePayment
                    ? "Esta opción no contacta a ONVO; solo registra que el reembolso manual ya se realizó."
                    : "Se hará un reembolso total y el pedido quedará cancelado al confirmarse."}
                </span>
              </span>
            </label>
          )}
          {canPartiallyRefundTilopay && (
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
              <Checkbox
                checked={refundProducts && refundType === "partial"}
                onCheckedChange={(checked) => {
                  setRefundProducts(checked === true);
                  if (checked === true) {
                    setRefundType("partial");
                    setCancelUber(false);
                  }
                }}
                aria-label="Reembolsar un monto parcial con Tilo Pay"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">Reembolsar monto parcial con Tilo Pay</span>
                <span className="block text-xs text-muted-foreground">
                  El pedido seguirá activo. Tilo Pay devolverá únicamente el monto indicado.
                </span>
              </span>
            </label>
          )}
        </div>

        {refundProducts && refundType === "partial" && (
          <div className="space-y-1.5">
            <label htmlFor="partial-refund-amount" className="text-sm font-medium">
              Monto a reembolsar
            </label>
            <Input
              id="partial-refund-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={partialRefundAmount}
              onChange={(event) => setPartialRefundAmount(event.target.value)}
              aria-describedby="partial-refund-help"
            />
            <p id="partial-refund-help" className="text-xs text-muted-foreground">
              Debe ser mayor que cero y menor que el saldo reembolsable. El servidor verificará el monto antes de contactar a Tilo Pay.
            </p>
          </div>
        )}

        {isSinpePayment && refundProducts && (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <Checkbox
              checked={sinpeRefundAcknowledged}
              onCheckedChange={(checked) => setSinpeRefundAcknowledged(checked === true)}
              aria-label="Confirmar reembolso manual de SINPE"
            />
            <span className="text-sm font-medium">
              Confirmo que ya realicé manualmente el reembolso de SINPE Móvil al cliente.
            </span>
          </label>
        )}

        {requiresManualPaidOutRefund && refundProducts && (
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <Checkbox
              checked={paidOutRefundAcknowledged}
              onCheckedChange={(checked) => setPaidOutRefundAcknowledged(checked === true)}
              aria-label="Confirmar reembolso manual de pago liquidado"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">
                Confirmo que ya realicé manualmente el reembolso al cliente.
              </span>
              <span className="block text-xs text-muted-foreground">
                ONVO informó que el pago ya fue liquidado a la farmacia y no puede reembolsarlo automáticamente. Al confirmar, el pedido se cancelará y el pago se marcará como reembolsado.
              </span>
            </span>
          </label>
        )}

        {cancelUber && (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Motivo de cancelación</label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un motivo" />
                </SelectTrigger>
                <SelectContent>
                  {UBER_CANCEL_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isOther && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Descripción <span className="text-muted-foreground">(requerida)</span>
                </label>
                <Textarea
                  placeholder="Describe el motivo de cancelación..."
                  value={additionalDescription}
                  onChange={(e) => setAdditionalDescription(e.target.value)}
                  rows={3}
                  maxLength={280}
                />
              </div>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Volver</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {isPending ? "Procesando..." : "Confirmar acciones"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
