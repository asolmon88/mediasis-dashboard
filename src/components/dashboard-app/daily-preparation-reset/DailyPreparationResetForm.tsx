"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateDailyPreparationResetSettings } from "@/app/admin/dashboard-app/daily-preparation-reset/actions";
import { dailyPreparationResetSchema, type DailyPreparationResetSettings } from "@/lib/dashboard/daily-preparation-reset";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { restrictedDefaultLocationIds } from "@/lib/dashboard/location-scope";

function methodInputs(settings: DailyPreparationResetSettings) {
  return Object.fromEntries(settings.methods.map((method) => [method.id, {
    usesDefault: method.uses_default,
    minutes: String(method.reset_minutes),
  }]));
}

export default function DailyPreparationResetForm({ initialSettings }: { initialSettings: DailyPreparationResetSettings }) {
  const [saved, setSaved] = React.useState(initialSettings);
  const [enabled, setEnabled] = React.useState(initialSettings.enabled);
  const [everywhere, setEverywhere] = React.useState(initialSettings.available_everywhere);
  const [locationIds, setLocationIds] = React.useState(initialSettings.selected_location_ids);
  const [values, setValues] = React.useState(() => methodInputs(initialSettings));
  const [saving, setSaving] = React.useState(false);
  const initializedRestrictedLocations = React.useRef(false);
  const locked = !saved.can_manage_all_locations && saved.global_configuration_active;
  React.useEffect(() => {
    if (!saved.can_manage_all_locations && !saved.global_configuration_active && saved.selected_location_ids.length === 0 && !initializedRestrictedLocations.current) {
      initializedRestrictedLocations.current = true;
      setEverywhere(false);
      setLocationIds(restrictedDefaultLocationIds(saved.locations));
    }
  }, [saved.can_manage_all_locations, saved.global_configuration_active, saved.locations, saved.selected_location_ids.length]);
  const changedMethods = saved.methods.filter((method) => method.can_edit && (
    values[method.id].usesDefault !== method.uses_default ||
    (!values[method.id].usesDefault && values[method.id].minutes !== String(method.reset_minutes))
  ));
  const hasChanges = enabled !== saved.enabled || everywhere !== saved.available_everywhere ||
    [...locationIds].sort().join("|") !== [...saved.selected_location_ids].sort().join("|") || changedMethods.length > 0;
  const visibleMethods = saved.methods.filter((method) => everywhere || method.available_everywhere ||
    method.location_ids.some((id) => locationIds.includes(id)));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || locked) return;
    const input = {
      enabled, availableEverywhere: everywhere, businessLocationIds: everywhere ? [] : locationIds,
      methodValues: changedMethods.map((method) => ({
        id: method.id,
        resetMinutes: values[method.id].usesDefault ? null : Number(values[method.id].minutes),
      })),
    };
    if (!dailyPreparationResetSchema.safeParse(input).success) {
      toast.error("Seleccioná las ubicaciones y usá tiempos enteros entre 1 y 180 minutos.");
      return;
    }
    setSaving(true);
    try {
      const result = await updateDailyPreparationResetSettings(input);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      setSaved(result.settings);
      setEnabled(result.settings.enabled);
      setEverywhere(result.settings.available_everywhere);
      setLocationIds(result.settings.selected_location_ids);
      setValues(methodInputs(result.settings));
      toast.success("Reinicio diario de preparación actualizado.");
    } catch {
      toast.error("No se pudo guardar el reinicio diario. Intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold">Reinicio diario de tiempos de preparación</CardTitle>
        <CardDescription>
          Restablecé cada día los tiempos de pickup, express y todos tus métodos de delivery.
          Esta opción funciona de forma independiente de los estados automáticos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="daily-reset-enabled">Activar reinicio diario</Label>
              <p id="daily-reset-description" className="text-sm text-muted-foreground">
                El primer reinicio será al comenzar el próximo día, durante el primer minuto después de medianoche.
                Podés ajustar los tiempos durante el día; se conservarán hasta el siguiente reinicio.
              </p>
            </div>
            <Switch id="daily-reset-enabled" checked={enabled}
              aria-describedby="daily-reset-description"
              disabled={saving || locked || (!saved.timezone_valid && !enabled)} onCheckedChange={setEnabled} />
          </div>
          <p className="text-sm text-muted-foreground">
            Zona horaria del negocio: <span className="font-medium">{saved.timezone ?? "Sin configurar"}</span>
          </p>
          {!saved.timezone_valid ? (
            <p role="alert" className="text-sm text-destructive">
              Configurá una zona horaria válida en los ajustes de mercado para activar el reinicio diario.
            </p>
          ) : null}
          {locked ? (
            <p className="text-sm text-muted-foreground">
              El reinicio está activo para todo el negocio. Solo un administrador con acceso a todas las ubicaciones puede cambiarlo.
            </p>
          ) : !saved.can_manage_all_locations ? (
            <p className="text-sm text-muted-foreground">Solo podés configurar las ubicaciones que tenés asignadas.</p>
          ) : null}
          <fieldset disabled={saving || locked || !enabled} className="space-y-4">
            <legend className="mb-3 text-sm font-medium">Ubicaciones del reinicio</legend>
            {saved.can_manage_all_locations ? <div className="flex items-center gap-3">
              <Checkbox id="daily-reset-everywhere" checked={everywhere}
                disabled={saving || locked || !enabled || !saved.can_manage_all_locations}
                onCheckedChange={(checked) => { setEverywhere(checked === true); }} />
              <Label htmlFor="daily-reset-everywhere">Todas las ubicaciones, incluidas las nuevas</Label>
            </div> : null}
            {(!saved.can_manage_all_locations || !everywhere) && !locked ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {saved.locations.map((location) => (
                  <div key={location.business_location_id} className="flex items-center gap-3">
                    <Checkbox id={`daily-reset-location-${location.business_location_id}`}
                      checked={locationIds.includes(location.business_location_id)}
                      disabled={saving || locked || !enabled}
                      onCheckedChange={(checked) => setLocationIds((ids) => checked === true
                        ? [...new Set([...ids, location.business_location_id])]
                        : ids.filter((id) => id !== location.business_location_id))} />
                    <Label htmlFor={`daily-reset-location-${location.business_location_id}`}>{location.short_name}</Label>
                  </div>
                ))}
                {!saved.locations.length ? <p className="text-sm text-muted-foreground">No hay ubicaciones disponibles.</p> : null}
              </div>
            ) : null}
          </fieldset>
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-sm font-medium">Tiempo de reinicio por método</h2>
              <p className="text-sm text-muted-foreground">
                Recomendamos 10 minutos. Cada método comparte su valor entre las ubicaciones donde está disponible;
                el reinicio solo se aplica en las ubicaciones activadas. Los métodos nuevos usarán 10 minutos.
              </p>
            </div>
            {visibleMethods.map((method) => (
              <fieldset key={method.id} disabled={saving || locked || !enabled || !method.can_edit}
                className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{method.name ?? "Método de delivery"}</legend>
                <div className="flex items-center gap-3">
                  <Checkbox id={`daily-reset-default-${method.id}`} checked={values[method.id].usesDefault}
                    disabled={saving || locked || !enabled || !method.can_edit}
                    onCheckedChange={(checked) => setValues((current) => ({ ...current,
                      [method.id]: { ...current[method.id], usesDefault: checked === true },
                    }))} />
                  <Label htmlFor={`daily-reset-default-${method.id}`}>Usar 10 minutos (recomendado)</Label>
                </div>
                {!values[method.id].usesDefault ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Label htmlFor={`daily-reset-minutes-${method.id}`}>Tiempo personalizado (minutos)</Label>
                    <Input id={`daily-reset-minutes-${method.id}`} className="w-24" type="number"
                      min={1} max={180} step={1} required value={values[method.id].minutes}
                      onChange={(event) => setValues((current) => ({ ...current,
                        [method.id]: { ...current[method.id], minutes: event.target.value },
                      }))} />
                  </div>
                ) : null}
                {!method.can_edit ? (
                  <p className="text-sm text-muted-foreground">
                    Este método se comparte con ubicaciones fuera de tu acceso. Su tiempo debe cambiarlo un administrador con acceso a todas ellas.
                  </p>
                ) : null}
              </fieldset>
            ))}
            {!visibleMethods.length ? (
              <p className="text-sm text-muted-foreground">No hay métodos de delivery para las ubicaciones seleccionadas.</p>
            ) : null}
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || locked || !hasChanges || (enabled && !saved.timezone_valid)}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Guardar reinicio diario
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
