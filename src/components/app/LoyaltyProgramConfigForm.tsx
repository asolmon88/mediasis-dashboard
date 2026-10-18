"use client"

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  getLoyaltyProgramsForBusiness,
  upsertLoyaltyPrograms,
} from "@/app/admin/app/checkout/actions";
import type { LoyaltyProgramConfigInput } from "@/app/admin/app/checkout/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
  type MultiSelectValue,
} from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useBusinessLocations } from "@/stores/location-store";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

const loyaltyProgramTypes = ["stamps", "cashback", "loyalty"] as const;

const loyaltyProgramLabels: Record<(typeof loyaltyProgramTypes)[number], string> = {
  stamps: "Sellos",
  cashback: "Cashback",
  loyalty: "Lealtad",
};

type LoyaltyProgramType = (typeof loyaltyProgramTypes)[number];

type LoyaltyProgramConfig = LoyaltyProgramConfigInput & {
  local_id: string;
  scope: "all" | "specific";
  scope_locked?: boolean;
  delete_allowed?: boolean;
};

export type LoyaltyProgramConfigFormHandle = {
  save: () => Promise<{ success: boolean; message?: string }>;
  discard: () => void;
};

type LoyaltyProgramConfigFormProps = {
  enabled: boolean;
  onValidationError?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function getDefaultLoyaltyProgramConfig(scope: "all" | "specific" = "all"): LoyaltyProgramConfig {
  return {
    local_id: crypto.randomUUID(),
    program_type: "stamps",
    card_url: "",
    active: true,
    scope,
    location_ids: [],
  };
}

const LoyaltyProgramConfigForm = React.forwardRef<
  LoyaltyProgramConfigFormHandle,
  LoyaltyProgramConfigFormProps
>(function LoyaltyProgramConfigForm({ enabled, onValidationError, onDirtyChange }, ref) {
  const [loading, setLoading] = React.useState(true);
  const businessLocations = useBusinessLocations();
  const authorization = useDashboardAuthorization();
  const canManageAllLocations = authorization.mode === "legacy" || authorization.allLocations;
  const [loyaltyConfigs, setLoyaltyConfigs] = React.useState<LoyaltyProgramConfig[]>([]);
  const [removedLoyaltyConfigIds, setRemovedLoyaltyConfigIds] = React.useState<string[]>([]);
  const mountedRef = React.useRef(false);
  const savedConfigsRef = React.useRef<LoyaltyProgramConfig[]>([]);

  const loadLoyaltyPrograms = React.useCallback(async () => {
    setLoading(true);
    const result = await getLoyaltyProgramsForBusiness();
    if (!mountedRef.current) return result;

    if (!result.success) {
      toast.error(result.message);
      setLoading(false);
      return result;
    }

    const nextConfigs = (result.data ?? []).map((config) => ({
        local_id: config.loyalty_program_id,
        loyalty_program_id: config.loyalty_program_id,
        program_type: config.program_type as LoyaltyProgramType,
        card_url: config.card_url,
        active: config.active,
        scope: config.scope,
        location_ids: config.location_ids ?? [],
        scope_locked: config.scope_locked,
        delete_allowed: config.delete_allowed,
      }));
    savedConfigsRef.current = nextConfigs;
    setLoyaltyConfigs(nextConfigs);
    setRemovedLoyaltyConfigIds([]);
    setLoading(false);
    return result;
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;

    loadLoyaltyPrograms();

    return () => {
      mountedRef.current = false;
    };
  }, [loadLoyaltyPrograms]);

  React.useEffect(() => {
    if (!loading) onDirtyChange?.(
      JSON.stringify(loyaltyConfigs) !== JSON.stringify(savedConfigsRef.current) || removedLoyaltyConfigIds.length > 0
    );
  }, [loading, loyaltyConfigs, removedLoyaltyConfigIds, onDirtyChange]);

  const updateLoyaltyConfig = (localId: string, value: Partial<LoyaltyProgramConfig>) => {
    setLoyaltyConfigs((current) =>
      current.map((config) =>
        config.local_id === localId ? { ...config, ...value } : config
      )
    );
  };

  const addLoyaltyConfig = () => {
    if (!canManageAllLocations && loyaltyConfigs.some((config) => config.scope === "all")) {
      toast.error("No podés agregar otro enlace mientras exista uno para todas las ubicaciones.");
      return;
    }
    setLoyaltyConfigs((current) => {
      const allLocationIds = businessLocations.map((location) => location.business_location_id);
      const normalizedCurrent = current.length === 1 && current[0].scope === "all"
        ? [{ ...current[0], scope: "specific" as const, location_ids: allLocationIds }]
        : current;

      return [
        ...normalizedCurrent,
        {
          ...getDefaultLoyaltyProgramConfig(!canManageAllLocations || normalizedCurrent.length > 0 ? "specific" : "all"),
          location_ids: !canManageAllLocations
            ? businessLocations.map((location) => location.business_location_id)
            : [],
        },
      ];
    });
  };

  const removeLoyaltyConfig = (config: LoyaltyProgramConfig) => {
    if (config.delete_allowed === false) {
      toast.error("Este enlace también está asignado a ubicaciones que no podés administrar.");
      return;
    }
    setLoyaltyConfigs((current) => current.filter((item) => item.local_id !== config.local_id));
    const loyaltyProgramId = config.loyalty_program_id;
    if (!loyaltyProgramId) return;

    setRemovedLoyaltyConfigIds((current) => [...current, loyaltyProgramId]);
  };

  const getSelectedLocationValues = (locationIds: string[]) =>
    locationIds.map((id): MultiSelectValue => ({
      value: id,
      label: businessLocations.find((location) => location.business_location_id === id)?.short_name || id,
    }));

  const validateLoyaltyConfigs = React.useCallback(() => {
    const activeConfigs = loyaltyConfigs.filter((config) => config.active);
    const hasMultipleActiveConfigs = activeConfigs.length > 1;
    const usedLocations = new Set<string>();

    for (const config of activeConfigs) {
      if (!loyaltyProgramTypes.includes(config.program_type as LoyaltyProgramType)) {
        return "Seleccione un tipo válido para el programa de lealtad.";
      }

      if (!config.card_url.trim()) {
        return "Ingrese el URL de la tarjeta del programa de lealtad.";
      }

      try {
        new URL(config.card_url);
      } catch {
        return "Ingrese un URL válido para la tarjeta del programa de lealtad.";
      }

      if (config.scope === "specific" && config.location_ids.length === 0) {
        return "Seleccione al menos una ubicación para cada enlace específico de lealtad.";
      }

      if (hasMultipleActiveConfigs && config.scope === "all") {
        return "Cuando hay más de un enlace de lealtad, cada enlace debe tener ubicaciones específicas.";
      }

      for (const locationId of config.scope === "specific" ? config.location_ids : []) {
        if (usedLocations.has(locationId)) {
          return "Una ubicación no puede estar asignada a más de un enlace activo de lealtad.";
        }
        usedLocations.add(locationId);
      }
    }

    return null;
  }, [loyaltyConfigs]);

  React.useImperativeHandle(ref, () => ({
    discard() {
      setLoyaltyConfigs(savedConfigsRef.current);
      setRemovedLoyaltyConfigIds([]);
      onDirtyChange?.(false);
    },
    async save() {
      if (!enabled) return { success: true };
      if (loading) {
        return { success: false, message: "Espere a que carguen los programas de lealtad." };
      }

      const validationError = validateLoyaltyConfigs();
      if (validationError) {
        onValidationError?.(validationError);
        return { success: false, message: validationError };
      }

      const result = await upsertLoyaltyPrograms({
        configs: loyaltyConfigs
          .filter((config) => config.loyalty_program_id || config.active)
          .map(({ local_id, scope, scope_locked: _scopeLocked, delete_allowed: _deleteAllowed, ...config }) => ({
            ...config,
            location_ids: scope === "all" ? [] : config.location_ids,
          })),
        delete_ids: removedLoyaltyConfigIds,
      });

      if (!result.success) return result;

      const reloadResult = await loadLoyaltyPrograms();
      if (!reloadResult.success) {
        return {
          success: false,
          message: reloadResult.message ?? "Los programas se guardaron, pero no se pudieron recargar.",
        };
      }

      return result;
    },
  }), [enabled, loadLoyaltyPrograms, loading, loyaltyConfigs, onDirtyChange, onValidationError, removedLoyaltyConfigIds, validateLoyaltyConfigs]);

  const activeLoyaltyConfigsCount = loyaltyConfigs.filter((config) => config.active).length;
  const hasMultipleLoyaltyConfigs = loyaltyConfigs.length > 1;

  if (!enabled) return null;

  return (
    <Card className="w-full rounded-3xl">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-md font-semibold">Configuración de programa de lealtad</div>
          <Button type="button" variant="outline" size="sm" onClick={addLoyaltyConfig}>
            <Plus className="mr-2 size-3" />
            Agregar enlace
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando programas de lealtad...</p>
        ) : loyaltyConfigs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Agregue un enlace de tarjeta para activar la configuración del programa.
          </p>
        ) : (
          <div className="space-y-4">
            {loyaltyConfigs.map((config, index) => {
              const canUseAllLocationScope = canManageAllLocations && activeLoyaltyConfigsCount <= 1;

              return (
                <div key={config.local_id} className="space-y-4 rounded-xl border border-border/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">Enlace {index + 1}</div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={config.active}
                          onCheckedChange={(checked) => updateLoyaltyConfig(config.local_id, { active: checked })}
                        />
                        <span>Activo</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                        onClick={() => removeLoyaltyConfig(config)}
                        aria-label="Eliminar enlace"
                        disabled={config.delete_allowed === false}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel>Tipo de programa</FieldLabel>
                      <Select
                        value={config.program_type}
                        onValueChange={(value) =>
                          updateLoyaltyConfig(config.local_id, { program_type: value as LoyaltyProgramType })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          {loyaltyProgramTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {loyaltyProgramLabels[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel>URL de la tarjeta</FieldLabel>
                      <Input
                        type="url"
                        value={config.card_url}
                        onChange={(event) => updateLoyaltyConfig(config.local_id, { card_url: event.target.value })}
                        placeholder="https://..."
                      />
                    </Field>
                  </div>

                  <Field>
                    {canManageAllLocations && !hasMultipleLoyaltyConfigs && (
                      <div className="flex items-center space-x-3">
                        <Checkbox
                          id={`loyalty_available_everywhere_${config.local_id}`}
                          checked={config.scope === "all"}
                          disabled={!canManageAllLocations || config.scope_locked === true}
                          onCheckedChange={(checked) => {
                            if (checked && !canUseAllLocationScope && config.active) {
                              toast.error("Solo puede usar todas las ubicaciones cuando hay un único enlace activo.");
                              return;
                            }
                            updateLoyaltyConfig(config.local_id, {
                              scope: checked ? "all" : "specific",
                              location_ids: [],
                            });
                          }}
                        />
                        <label
                          htmlFor={`loyalty_available_everywhere_${config.local_id}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          Disponible en todas las ubicaciones
                        </label>
                      </div>
                    )}

                    {config.scope === "specific" && (
                      <div className={hasMultipleLoyaltyConfigs ? "space-y-2" : "mt-3 space-y-2"}>
                        <FieldLabel>Ubicaciones</FieldLabel>
                        <MultiSelector
                          values={getSelectedLocationValues(config.location_ids)}
                          onValuesChange={(values) =>
                            updateLoyaltyConfig(config.local_id, {
                              location_ids: values.map((value) => value.value),
                            })
                          }
                          loop
                          className="w-full"
                        >
                          <MultiSelectorTrigger>
                            <MultiSelectorInput placeholder="Selecciona las ubicaciones disponibles" />
                          </MultiSelectorTrigger>
                          <MultiSelectorContent>
                            <MultiSelectorList>
                              {businessLocations.map((location) => {
                                const assignedToAnotherActiveConfig = loyaltyConfigs.some(
                                  (otherConfig) =>
                                    otherConfig.local_id !== config.local_id &&
                                    otherConfig.active &&
                                    otherConfig.scope === "specific" &&
                                    otherConfig.location_ids.includes(location.business_location_id)
                                );

                                return (
                                  <MultiSelectorItem
                                    key={location.business_location_id}
                                    value={location.business_location_id}
                                    label={location.short_name}
                                    disabled={assignedToAnotherActiveConfig}
                                  >
                                    {location.short_name}
                                  </MultiSelectorItem>
                                );
                              })}
                            </MultiSelectorList>
                          </MultiSelectorContent>
                        </MultiSelector>
                      </div>
                    )}
                  </Field>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

export default LoyaltyProgramConfigForm;
