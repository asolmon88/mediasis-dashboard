"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  type AutomaticStatusSettingsInput,
  updateAutomaticStatusSettings,
} from "@/app/admin/dashboard-app/automatic-statuses/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { restrictedDefaultLocationIds } from "@/lib/dashboard/location-scope";

type BusinessLocation = {
  business_location_id: string;
  short_name: string;
};

type AutomaticStatusesFormProps = {
  locations: BusinessLocation[];
  initialSettings: AutomaticStatusSettingsInput;
  canManageAllLocations: boolean;
  globalConfigurationActive: boolean;
};

export default function AutomaticStatusesForm({
  locations,
  initialSettings,
  canManageAllLocations,
  globalConfigurationActive,
}: AutomaticStatusesFormProps) {
  const [savedSettings, setSavedSettings] = React.useState(initialSettings);
  const [enabled, setEnabled] = React.useState(initialSettings.enabled);
  const [availableEverywhere, setAvailableEverywhere] = React.useState(
    initialSettings.availableEverywhere
  );
  const [selectedLocationIds, setSelectedLocationIds] = React.useState(
    initialSettings.businessLocationIds
  );
  const [saving, setSaving] = React.useState(false);
  const initializedRestrictedLocations = React.useRef(false);

  React.useEffect(() => {
    if (!canManageAllLocations && !globalConfigurationActive && initialSettings.businessLocationIds.length === 0 && !initializedRestrictedLocations.current) {
      initializedRestrictedLocations.current = true;
      setAvailableEverywhere(false);
      setSelectedLocationIds(restrictedDefaultLocationIds(locations));
    }
  }, [canManageAllLocations, globalConfigurationActive, initialSettings.businessLocationIds.length, locations]);

  const selectedLocationValues = React.useMemo(
    () =>
      selectedLocationIds.map(
        (locationId): MultiSelectValue => ({
          value: locationId,
          label:
            locations.find((location) => location.business_location_id === locationId)?.short_name ??
            locationId,
        })
      ),
    [locations, selectedLocationIds]
  );

  const normalizedSelectedLocationIds = React.useMemo(
    () => [...selectedLocationIds].sort(),
    [selectedLocationIds]
  );

  const hasChanges =
    enabled !== savedSettings.enabled ||
    availableEverywhere !== savedSettings.availableEverywhere ||
    normalizedSelectedLocationIds.join("|") !==
      [...savedSettings.businessLocationIds].sort().join("|");

  const handleEverywhereChange = (checked: boolean) => {
    setAvailableEverywhere(checked);

    if (checked) {
      setSelectedLocationIds([]);
      return;
    }

    if (selectedLocationIds.length === 0 && locations[0]?.business_location_id) {
      setSelectedLocationIds([locations[0].business_location_id]);
    }
  };

  const handleSubmit = async () => {
    if (enabled && !availableEverywhere && selectedLocationIds.length === 0) {
      toast.error("Selecciona al menos una ubicación o activa todas las ubicaciones.");
      return;
    }

    setSaving(true);
    const result = await updateAutomaticStatusSettings({
      enabled,
      availableEverywhere,
      businessLocationIds: selectedLocationIds,
    });
    setSaving(false);

    if (!result.success) {
      toast.error(result.message ?? "No se pudo guardar la configuración.");
      return;
    }

    toast.success("Estados automáticos actualizados.");
    setSavedSettings({
      enabled,
      availableEverywhere,
      businessLocationIds: normalizedSelectedLocationIds,
    });
    setSelectedLocationIds(normalizedSelectedLocationIds);
  };

  return (
    <div className="px-4 py-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Estados automáticos</h1>
          <p className="text-sm text-muted-foreground">
            Automatiza el avance a Preparando de pedidos pagados y el paso a Listo de pedidos sin motorizado.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px] font-semibold">App de dashboard</CardTitle>
            <CardDescription>
              Los pedidos pagados pasan a Preparando automáticamente. Los pedidos sin motorizado
              pasan a Listo cuando llega su hora de pickup.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="automatic-statuses-enabled">Activar estados automáticos</Label>
                <p className="text-sm text-muted-foreground">
                  Las órdenes pagadas pasan a Preparando automáticamente. Solo las órdenes sin
                  motorizado pasan a Listo por hora de pickup.
                </p>
              </div>
              <Switch
                id="automatic-statuses-enabled"
                checked={enabled}
                disabled={saving || (!canManageAllLocations && globalConfigurationActive)}
                onCheckedChange={setEnabled}
              />
            </div>

            <div className="space-y-4">
              {canManageAllLocations ? <div className="flex items-center space-x-3">
                <Checkbox
                  id="automatic-statuses-everywhere"
                  checked={availableEverywhere}
                  disabled={!enabled || saving || !canManageAllLocations}
                  onCheckedChange={(checked) => handleEverywhereChange(Boolean(checked))}
                />
                <Label
                  htmlFor="automatic-statuses-everywhere"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Disponible en todas las ubicaciones
                </Label>
              </div> : null}

              {!canManageAllLocations && globalConfigurationActive ? (
                <p className="text-sm text-muted-foreground">
                  Los estados automáticos están activos para todo el negocio; ese alcance no puede modificarse desde tu acceso.
                </p>
              ) : null}

              {!canManageAllLocations ? (
                <p className="text-sm text-muted-foreground">
                  Solo podés configurar los estados automáticos en las ubicaciones que tenés asignadas.
                </p>
              ) : null}

              {enabled && (!canManageAllLocations || !availableEverywhere) && !globalConfigurationActive ? (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Ubicaciones</Label>
                  <MultiSelector
                    values={selectedLocationValues}
                    onValuesChange={(values) =>
                      setSelectedLocationIds(values.map((value) => value.value))
                    }
                    loop
                    className="w-full"
                  >
                    <MultiSelectorTrigger>
                      <MultiSelectorInput placeholder="Selecciona ubicaciones con estados automáticos" />
                    </MultiSelectorTrigger>
                    <MultiSelectorContent>
                      <MultiSelectorList>
                        {locations.map((location) => (
                          <MultiSelectorItem
                            key={location.business_location_id}
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

            <div className="flex justify-end">
              <Button onClick={handleSubmit} disabled={saving || !hasChanges}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Guardar cambios
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
