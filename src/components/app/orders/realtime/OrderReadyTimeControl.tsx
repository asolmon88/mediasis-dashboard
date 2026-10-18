"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Pencil, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrderRealtimeOrder } from "@/lib/types/dashboardTypes";
import { updateUberPickupWindowAction } from "@/app/admin/orders/realtime/actions";
import { toast } from "sonner";

type OrderReadyTimeControlProps = {
  order: OrderRealtimeOrder | null;
};

const DEFAULT_MINUTES = 2;

function getConfiguredMinutes(order: OrderRealtimeOrder | null) {
  // Prefer uber_delivery fields (source of truth); fall back to orders fields
  const pickupReadyRaw = order?.uber_delivery?.pickup_ready ?? order?.pickup_ready_dt;
  const createdAtRaw = order?.uber_delivery?.created_at ?? order?.delivery_created_at;

  if (!pickupReadyRaw || !createdAtRaw) return DEFAULT_MINUTES;
  const readyAtMs = new Date(pickupReadyRaw).getTime();
  const createdAtMs = new Date(createdAtRaw).getTime();
  if (Number.isNaN(readyAtMs) || Number.isNaN(createdAtMs)) return DEFAULT_MINUTES;
  return Math.max(1, Math.round((readyAtMs - createdAtMs) / 60000));
}

export function OrderReadyTimeControl({ order }: OrderReadyTimeControlProps) {
  const configuredMinutes = useMemo(() => getConfiguredMinutes(order), [order]);
  const [isEditing, setIsEditing] = useState(false);
  const [minutes, setMinutes] = useState(configuredMinutes);
  const [displayMinutes, setDisplayMinutes] = useState(configuredMinutes);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setDisplayMinutes(configuredMinutes);
    if (!isEditing) {
      setMinutes(configuredMinutes);
    }
  }, [configuredMinutes, isEditing]);

  if (!order) return null;

  const decrease = () => setMinutes((prev) => Math.max(1, prev - 1));
  const increase = () => setMinutes((prev) => Math.min(180, prev + 1));
  const cancelEdit = () => {
    setMinutes(displayMinutes);
    setIsEditing(false);
  };

  const onSave = () => {
    startTransition(async () => {
      const result = await updateUberPickupWindowAction(order.order_id, minutes);
      if (!result.success) {
        toast.error(result.message ?? "No se pudo actualizar la hora de pickup");
        return;
      }

      setDisplayMinutes(minutes);
      setIsEditing(false);
      toast.success("Hora de pickup actualizada");
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Lista en</h3>
        <button
          type="button"
          className="h-8 w-8 rounded-full border border-border inline-flex items-center justify-center hover:bg-muted cursor-pointer"
          onClick={() => setIsEditing((prev) => !prev)}
          aria-label="Editar tiempo de preparación"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">{displayMinutes} minutos</p>
      <p className="text-xs text-muted-foreground">
        {order.delivery_method?.require_courier
          ? "Un socio de la app recolectará el pedido cuando esté listo."
          : "Tiempo estimado para tener el pedido listo."}
      </p>

      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          isEditing ? "max-h-60 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="mt-2 rounded-xl border border-border p-3 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">Hora en que estará listo el pedido</p>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              className="h-9 w-9 rounded-full border border-border inline-flex items-center justify-center hover:bg-muted cursor-pointer"
              onClick={decrease}
              disabled={isPending}
              aria-label="Restar minuto"
            >
              <Minus className="h-4 w-4" />
            </button>
            <p className="text-2xl font-semibold min-w-20 text-center">{minutes} min</p>
            <button
              type="button"
              className="h-9 w-9 rounded-full border border-border inline-flex items-center justify-center hover:bg-muted cursor-pointer"
              onClick={increase}
              disabled={isPending}
              aria-label="Sumar minuto"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="flex-1"
              onClick={onSave}
              disabled={isPending}
            >
              Guardar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={cancelEdit}
              disabled={isPending}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
