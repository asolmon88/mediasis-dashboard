"use client"

import { useMemo, useState } from "react"
import { useFormContext } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { Loader2Icon } from "lucide-react"
import { OpenHours, OpenHoursSchema } from "@/lib/FormSchemas/openHoursSchema"
import { applyOpenHoursToLocations } from "@/app/admin/open-hours/applyActions"
import { applyOrderingOpenHoursToLocations } from "@/app/admin/app/open-hours/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { MultiSelectValue } from "@/components/ui/multi-select"
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
} from "@/components/ui/multi-select"
import { useActiveLocationId, useBusinessLocations } from "@/stores/location-store"
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider"

export default function ApplyScheduleDialog({ type, canManageAllLocations = true }: { type: 'orders' | 'reservation'; canManageAllLocations?: boolean }) {
  const form = useFormContext<OpenHours>();
  const [open, setOpen] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<MultiSelectValue[]>([]);
  const [applying, setApplying] = useState(false);
  const locations = useBusinessLocations();
  const authorization = useDashboardAuthorization();
  const activeLocationId = useActiveLocationId();
  const availableLocations = useMemo(() => type === 'reservation'
    ? locations.filter((location) => authorization.reservationLocationIds.includes(location.business_location_id))
    : locations, [authorization.reservationLocationIds, locations, type]);
  const otherLocations = useMemo(
    () => availableLocations.filter((location) => location.business_location_id !== activeLocationId),
    [activeLocationId, availableLocations]
  );

  async function handleApply() {
    const parsed = OpenHoursSchema.safeParse(form.getValues());
    if (!parsed.success) {
      toast.error(z.prettifyError(parsed.error));
      return;
    }
    setApplying(true);
    const input = { values: parsed.data, business_location_ids: selectedLocations.map(l => l.value), applyToAll };
    const result = type === "orders"
      ? await applyOrderingOpenHoursToLocations(input)
      : await applyOpenHoursToLocations({ ...input, type });
    setApplying(false);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success(result.message);
    setOpen(false);
    setSelectedLocations([]);
    setApplyToAll(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">Aplicar a otras ubicaciones</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aplicar horario a otras ubicaciones</DialogTitle>
          <DialogDescription>
            El horario actual del formulario sobrescribirá el horario de las ubicaciones seleccionadas.
            &quot;Todas las ubicaciones&quot; incluye también la ubicación actual.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="apply-schedule-all-locations"
              checked={applyToAll}
              onCheckedChange={(value) => setApplyToAll(Boolean(value))}
              disabled={!canManageAllLocations}
              className="size-5"
            />
            <label
              htmlFor="apply-schedule-all-locations"
              className="text-sm font-medium leading-none"
            >
              Todas las ubicaciones
            </label>
          </div>
          {!canManageAllLocations ? (
            <p className="text-xs text-muted-foreground">Solo podés aplicar el horario a las ubicaciones que tenés asignadas.</p>
          ) : null}
          {!applyToAll ? (
            <MultiSelector
              values={selectedLocations}
              onValuesChange={setSelectedLocations}
              loop
              className="w-full"
            >
              <MultiSelectorTrigger>
                <MultiSelectorInput placeholder="Selecciona ubicaciones" />
              </MultiSelectorTrigger>
              <MultiSelectorContent>
                <MultiSelectorList>
                  {otherLocations.map((location) => (
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
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={applying || (!applyToAll && selectedLocations.length === 0)}
          >
            {!applying ?
              "Aplicar" : (
                <div className="flex flex-row items-center justify-center gap-2">
                  <Loader2Icon className="animate-spin" />
                  Aplicando
                </div>
              )
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
