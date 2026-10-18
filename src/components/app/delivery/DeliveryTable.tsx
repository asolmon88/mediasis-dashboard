"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { delivery_methods_for_table } from "@/lib/types/dashboardTypes";
import { formatMinutesHuman, intervalToMinutes } from "@/lib/utils";
import {
  getDeliveryPickupOffsetsByLocation,
  updateDeliveryPickupReadyOffsetByLocation,
} from "@/app/admin/app/delivery/actions";
import { useRouter } from "next/navigation";
import { useActiveLocationId } from "@/stores/location-store";

type DeliveryTableProps = {
  delivery_methods: delivery_methods_for_table;
};

const pickupReadyOffsetPresets = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

export function DeliveryTable({ delivery_methods }: DeliveryTableProps) {
  const router = useRouter();
  const activeLocationId = useActiveLocationId();
  const [rows, setRows] = React.useState<delivery_methods_for_table>(delivery_methods);
  const [editingRowId, setEditingRowId] = React.useState<string | null>(null);
  const [editingMinutesByRow, setEditingMinutesByRow] = React.useState<Record<string, number>>({});
  const [offsetMinutesByRow, setOffsetMinutesByRow] = React.useState<Record<string, number>>({});
  const [pendingRows, setPendingRows] = React.useState<Record<string, boolean>>({});
  const warnedNoLocationRef = React.useRef(false);

  React.useEffect(() => {
    setRows(delivery_methods);
  }, [delivery_methods]);

  React.useEffect(() => {
    const rowIds = rows.map((row) => row.uid).filter(Boolean);

    if (!activeLocationId) {
      setOffsetMinutesByRow(
        rowIds.reduce<Record<string, number>>((acc, id) => {
          acc[id] = 5;
          return acc;
        }, {})
      );
      if (!warnedNoLocationRef.current) {
        warnedNoLocationRef.current = true;
        toast.error("Selecciona una ubicación activa para editar tiempo de preparación.");
      }
      return;
    }

    warnedNoLocationRef.current = false;

    let ignore = false;
    const loadOffsets = async () => {
      const result = await getDeliveryPickupOffsetsByLocation({
        business_location_id: activeLocationId,
        delivery_method_ids: rowIds,
      });

      if (ignore) return;

      if (!result.success) {
        toast.error(result.message ?? "No se pudieron cargar los tiempos de preparación.");
      }

      setOffsetMinutesByRow(
        rowIds.reduce<Record<string, number>>((acc, id) => {
          acc[id] = intervalToMinutes(result.offsets?.[id] ?? null);
          return acc;
        }, {})
      );
    };

    void loadOffsets();

    return () => {
      ignore = true;
    };
  }, [rows, activeLocationId]);

  const markPending = (rowId: string, value: boolean) => {
    setPendingRows((prev) => ({ ...prev, [rowId]: value }));
  };

  const setEditingMinutes = (rowId: string, minutes: number) => {
    setEditingMinutesByRow((prev) => ({ ...prev, [rowId]: minutes }));
  };

  const handleOpenQuickEdit = (event: React.MouseEvent<HTMLButtonElement>, rowId: string) => {
    event.stopPropagation();
    if (!activeLocationId) {
      toast.error("Selecciona una ubicación activa para editar tiempo de preparación.");
      return;
    }

    setEditingMinutes(rowId, offsetMinutesByRow[rowId] ?? 5);
    setEditingRowId((prev) => (prev === rowId ? null : rowId));
  };

  const handleSaveQuickEdit = async (
    event: React.MouseEvent<HTMLButtonElement>,
    rowId: string
  ) => {
    event.stopPropagation();

    if (!activeLocationId) {
      toast.error("Selecciona una ubicación activa para editar tiempo de preparación.");
      return;
    }

    const rawMinutes = editingMinutesByRow[rowId];
    const safeMinutes = Number.isFinite(rawMinutes) ? Math.round(rawMinutes) : NaN;
    if (Number.isNaN(safeMinutes) || safeMinutes < 1 || safeMinutes > 180) {
      toast.error("El tiempo debe estar entre 1 y 180 minutos.");
      return;
    }

    const previousMinutes = offsetMinutesByRow[rowId] ?? 5;
    setOffsetMinutesByRow((prev) => ({ ...prev, [rowId]: safeMinutes }));
    markPending(rowId, true);

    const result = await updateDeliveryPickupReadyOffsetByLocation({
      business_delivery_method_id: rowId,
      business_location_id: activeLocationId,
      pickup_ready_offset_minutes: safeMinutes,
    });

    markPending(rowId, false);

    if (!result.success) {
      setOffsetMinutesByRow((prev) => ({ ...prev, [rowId]: previousMinutes }));
      toast.error(result.message ?? "No se pudo actualizar el tiempo de preparación.");
      return;
    }

    setEditingRowId(null);
    toast.success("Tiempo de preparación actualizado.");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold">Delivery</CardTitle>
        <CardDescription>Métodos disponibles para tus pedidos.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {!activeLocationId ? (
          <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
            Selecciona una ubicación activa para editar el tiempo de preparación por local.
          </p>
        ) : null}
        <Table>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((method) => {
                const prepMinutes = offsetMinutesByRow[method.uid] ?? 5;
                const editingValue = editingMinutesByRow[method.uid] ?? prepMinutes;
                const isEditing = editingRowId === method.uid;
                const isPending = Boolean(pendingRows[method.uid]);

                return (
                  <TableRow
                    key={method.uid}
                    className="cursor-pointer"
                    onClick={() => router.push(`/admin/app/delivery/edit/${method.uid}`)}
                  >
                    <TableCell className="py-4">
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-row items-start justify-between gap-4">
                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="font-medium">{method.name}</span>
                            {method.instructions ? (
                              <span className="text-sm text-muted-foreground">
                                {method.instructions}
                              </span>
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                              Tiempo de preparación: {formatMinutesHuman(prepMinutes)}
                            </span>
                            <Badge
                              variant="secondary"
                              className={
                                method.visibility
                                  ? "uppercase bg-emerald-100 text-emerald-700 border-transparent"
                                  : "uppercase bg-muted text-muted-foreground"
                              }
                            >
                              {method.visibility ? "ACTIVO" : "INACTIVO"}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="uppercase bg-muted text-muted-foreground">
                              DELIVERY
                            </Badge>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={isPending || !activeLocationId}
                              onClick={(event) => handleOpenQuickEdit(event, method.uid)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          </div>
                        </div>

                        {isEditing ? (
                          <div
                            className="rounded-xl border p-3 space-y-3"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <p className="text-xs text-muted-foreground">
                              Tiempo de preparación para pickup_ready_dt
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {pickupReadyOffsetPresets.map((preset) => (
                                <Button
                                  key={preset}
                                  type="button"
                                  size="sm"
                                  variant={editingValue === preset ? "default" : "outline"}
                                  disabled={isPending}
                                  onClick={() => setEditingMinutes(method.uid, preset)}
                                >
                                  {formatMinutesHuman(preset)}
                                </Button>
                              ))}
                            </div>
                            <div className="max-w-40">
                              <Input
                                type="text"
                                inputMode="numeric"
                                value={editingValue}
                                disabled={isPending}
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  if (raw === "") {
                                    setEditingMinutes(method.uid, 0);
                                    return;
                                  }
                                  const next = Number(raw);
                                  if (!Number.isNaN(next)) {
                                    setEditingMinutes(method.uid, next);
                                  }
                                }}
                                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                disabled={isPending || !activeLocationId}
                                onClick={(event) => void handleSaveQuickEdit(event, method.uid)}
                              >
                                Guardar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={isPending}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditingMinutes(method.uid, prepMinutes);
                                  setEditingRowId(null);
                                }}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell className="text-center text-sm text-muted-foreground py-8">
                  No has agregado métodos de delivery.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
