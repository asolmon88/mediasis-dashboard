"use client";

import * as React from "react";
import { toast } from "sonner";

import { updatePaymentMethodBusiness } from "@/app/admin/app/payment-methods/actions";
import {
  payment_methods_for_table,
} from "@/lib/types/dashboardTypes";
import { useBusinessLocations } from "@/stores/location-store";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
  type MultiSelectValue,
} from "@/components/ui/multi-select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

type PaymentMethodsTableProps = {
  paymentMethods: payment_methods_for_table;
  canManageAllLocations: boolean;
  readOnly?: boolean;
};

export function PaymentMethodsTable({ paymentMethods, canManageAllLocations, readOnly = false }: PaymentMethodsTableProps) {
  const [rows, setRows] = React.useState<payment_methods_for_table>(paymentMethods);
  const businessLocations = useBusinessLocations();
  const [pendingRows, setPendingRows] = React.useState<Record<string, boolean>>({});
  const [availableEverywhereByRow, setAvailableEverywhereByRow] = React.useState<
    Record<string, boolean>
  >({});

  React.useEffect(() => {
    setRows(paymentMethods);
    setAvailableEverywhereByRow(
      paymentMethods.reduce<Record<string, boolean>>((acc, row) => {
        acc[row.business_payment_method_id] =
          row.scope === "all" || row.business_location_ids.length === 0;
        return acc;
      }, {})
    );
  }, [paymentMethods]);

  const markPending = (rowId: string, value: boolean) => {
    setPendingRows((prev) => ({ ...prev, [rowId]: value }));
  };

  const updateRow = async (
    rowId: string,
    next: { visible?: boolean; business_location_ids?: string[] }
  ): Promise<boolean> => {
    if (readOnly) return false;
    const current = rows.find((row) => row.business_payment_method_id === rowId);
    if (!current) return false;

    const nextLocationIds =
      next.business_location_ids === undefined
        ? current.business_location_ids
        : Array.from(new Set(next.business_location_ids.filter(Boolean)));

    const updatedRow = {
      ...current,
      visible: next.visible ?? current.visible,
      business_location_ids: nextLocationIds,
      scope: nextLocationIds.length > 0 ? "specific" : "all",
    };

    setRows((prev) =>
      prev.map((row) => (row.business_payment_method_id === rowId ? updatedRow : row))
    );

    markPending(rowId, true);
    const result = await updatePaymentMethodBusiness({
      business_payment_method_id: rowId,
      data: {
        payment_method_id: updatedRow.payment_method_id,
        business_location_ids: updatedRow.business_location_ids,
        scope: updatedRow.scope === "specific" ? "specific" : "all",
        visible: updatedRow.visible,
      },
    });
    markPending(rowId, false);

    if (!result.success) {
      setRows((prev) =>
        prev.map((row) => (row.business_payment_method_id === rowId ? current : row))
      );
      toast.error(result.message ?? "No se pudo guardar el método de pago.");
      return false;
    }

    toast.success("Método de pago actualizado.");
    return true;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold">Métodos de pago</CardTitle>
        <CardDescription>Configura visibilidad y disponibilidad por ubicación.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((method) => {
                const availableEverywhere =
                  availableEverywhereByRow[method.business_payment_method_id] ??
                  (method.scope === "all" || method.business_location_ids.length === 0);

                return (
                  <TableRow key={method.business_payment_method_id}>
                    <TableCell className="py-4">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="font-medium">{method.name}</p>
                            {method.is_manual && method.payee_name ? <p className="text-xs text-muted-foreground">A nombre de {method.payee_name}</p> : null}
                            {method.is_manual && method.instructions ? <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{method.instructions}</p> : null}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground">Visible</span>
                            <Switch
                              checked={method.visible}
                              disabled={readOnly || pendingRows[method.business_payment_method_id]}
                              onCheckedChange={(checked) => {
                                void updateRow(method.business_payment_method_id, {
                                  visible: checked,
                                });
                              }}
                            />
                          </div>
                        </div>

                        {canManageAllLocations && !readOnly ? <div className="flex items-center space-x-3">
                          <Checkbox
                            id={`available_everywhere_${method.business_payment_method_id}`}
                            checked={availableEverywhere}
                            disabled={pendingRows[method.business_payment_method_id] || !canManageAllLocations}
                            onCheckedChange={async (checked) => {
                              const next = Boolean(checked);
                              const rowId = method.business_payment_method_id;

                              setAvailableEverywhereByRow((prev) => ({
                                ...prev,
                                [rowId]: next,
                              }));

                              if (next) {
                                const ok = await updateRow(rowId, {
                                  business_location_ids: [],
                                });
                                if (!ok) {
                                  setAvailableEverywhereByRow((prev) => ({
                                    ...prev,
                                    [rowId]: !next,
                                  }));
                                }
                                return;
                              }

                              const fallbackLocationId = businessLocations[0]?.business_location_id;
                              if (!fallbackLocationId) {
                                toast.error("No hay ubicaciones disponibles para asignar.");
                                setAvailableEverywhereByRow((prev) => ({
                                  ...prev,
                                  [rowId]: true,
                                }));
                                return;
                              }

                              const ok = await updateRow(rowId, {
                                business_location_ids: [fallbackLocationId],
                              });
                              if (!ok) {
                                setAvailableEverywhereByRow((prev) => ({
                                  ...prev,
                                  [rowId]: true,
                                }));
                              }
                            }}
                          />
                          <label
                            htmlFor={`available_everywhere_${method.business_payment_method_id}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                          >
                            Disponible en todas las ubicaciones
                          </label>
                        </div> : null}
                        {readOnly ? <p className="text-xs text-muted-foreground">Este método está administrado por Mediasis con tu plan Uber.</p> : !canManageAllLocations ? (
                          <p className="text-xs text-muted-foreground">
                            {availableEverywhere
                              ? "Este método está disponible en todo el negocio y ese alcance no puede modificarse desde tu acceso."
                              : "Solo podés cambiar la disponibilidad en las ubicaciones que tenés asignadas."}
                          </p>
                        ) : null}

                        {!readOnly && !availableEverywhere ? (
                          <div className="space-y-2">
                            <MultiSelector
                              values={
                                method.business_location_ids.map(
                                  (locationId): MultiSelectValue => ({
                                    value: locationId,
                                    label:
                                      businessLocations.find(
                                        (loc) => loc.business_location_id === locationId
                                      )?.short_name ?? locationId,
                                  })
                                )
                              }
                              onValuesChange={(vals) => {
                                void updateRow(method.business_payment_method_id, {
                                  business_location_ids: vals.map((value) => value.value),
                                });
                              }}
                              loop
                              className="w-full"
                            >
                              <MultiSelectorTrigger>
                                <MultiSelectorInput placeholder="Selecciona la ubicación disponible" />
                              </MultiSelectorTrigger>
                              <MultiSelectorContent>
                                <MultiSelectorList>
                                  {businessLocations.map((location, idx) => (
                                    <MultiSelectorItem
                                      key={idx}
                                      value={location.business_location_id}
                                      label={location.short_name}
                                    >
                                      {location.short_name}
                                    </MultiSelectorItem>
                                  ))}
                                </MultiSelectorList>
                              </MultiSelectorContent>
                            </MultiSelector>
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell className="py-8 text-center text-sm text-muted-foreground">
                  No has agregado métodos de pago.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
