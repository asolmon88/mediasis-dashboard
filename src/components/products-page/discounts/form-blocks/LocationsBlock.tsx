"use client";

import type { BusinessLocations } from "@/lib/types/dashboardTypes";
import type { MultiSelectValue } from "@/components/ui/multi-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription } from "@/components/ui/field";
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
} from "@/components/ui/multi-select";

type LocationsBlockProps = {
  availableEverywhere: boolean;
  onAvailableEverywhereChange: (checked: boolean) => void;
  selectedLocations: MultiSelectValue[];
  onSelectedLocationsChange: (values: MultiSelectValue[]) => void;
  businessLocations: BusinessLocations;
  canManageAllLocations: boolean;
};

export default function LocationsBlock({
  availableEverywhere,
  onAvailableEverywhereChange,
  selectedLocations,
  onSelectedLocationsChange,
  businessLocations,
  canManageAllLocations,
}: LocationsBlockProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ubicaciones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field>
          {canManageAllLocations ? <div className="flex items-center gap-2.5">
            <Checkbox
              id="discount-available-everywhere"
              checked={availableEverywhere}
              disabled={!canManageAllLocations}
              onCheckedChange={(value) => onAvailableEverywhereChange(Boolean(value))}
              className="size-5"
            />
            <label
              htmlFor="discount-available-everywhere"
              className="text-sm font-medium leading-none"
            >
              Disponible en todas las ubicaciones
            </label>
          </div> : null}

          {(!canManageAllLocations || !availableEverywhere) ? (
            <div className="mt-3">
              <MultiSelector
                values={selectedLocations}
                onValuesChange={onSelectedLocationsChange}
                loop
                className="w-full"
              >
                <MultiSelectorTrigger>
                  <MultiSelectorInput placeholder="Selecciona las ubicaciones disponibles" />
                </MultiSelectorTrigger>
                <MultiSelectorContent>
                  <MultiSelectorList>
                    {businessLocations.map((location) => (
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

          <FieldDescription>
            Selecciona las ubicaciones donde estará disponible el descuento.
          </FieldDescription>
        </Field>
      </CardContent>
    </Card>
  );
}
