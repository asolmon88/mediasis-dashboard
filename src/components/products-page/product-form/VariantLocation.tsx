"use client";

import { useEffect, useState } from "react";
import { Control, Controller, useWatch } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
  MultiSelectValue,
} from "@/components/ui/multi-select";
import { BusinessLocations } from "@/lib/types/dashboardTypes";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

type VariantLocationProps = {
  index: number;
  control: Control<any>;
  businessLocations: BusinessLocations;
};

export default function VariantLocation({
  index,
  control,
  businessLocations,
}: VariantLocationProps) {
  const authorization = useDashboardAuthorization();
  const canManageAllLocations = authorization.mode === "legacy" || authorization.allLocations;
  const selectedLocations =
    useWatch({
      control,
      name: `variants.${index}.business_locations`,
    }) ?? [];
  const [availableEverywhere, setAvailableEverywhere] = useState(
    selectedLocations.length === 0,
  );

  useEffect(() => {
    setAvailableEverywhere(selectedLocations.length === 0);
  }, [selectedLocations.length]);

  return (
    <Controller
      name={`variants.${index}.business_locations`}
      control={control}
      render={({ field, fieldState }) => (
        <Field>
          {canManageAllLocations ? <div className="flex items-center space-x-3">
            <Checkbox
              id={`variant-available-everywhere-${index}`}
              checked={availableEverywhere}
              onCheckedChange={(checked) => {
                const next = Boolean(checked);
                setAvailableEverywhere(next);
                if (next) {
                  field.onChange([]);
                }
              }}
            />
            <label
              htmlFor={`variant-available-everywhere-${index}`}
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Disponible en todas las ubicaciones
            </label>
          </div> : null}

          {(!canManageAllLocations || !availableEverywhere) && (
            <div className="mt-3 space-y-2">
              <FieldLabel>Ubicaciones</FieldLabel>
              <MultiSelector
                values={field.value || []}
                onValuesChange={(vals: MultiSelectValue[]) => {
                  field.onChange(vals);
                  setAvailableEverywhere(vals.length === 0);
                }}
                loop
                className="w-full"
              >
                <MultiSelectorTrigger>
                  <MultiSelectorInput placeholder="Selecciona las ubicaciones disponibles" />
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
          )}

          <FieldDescription>
            Selecciona las ubicaciones donde quieres que esté disponible la variante del producto.
          </FieldDescription>
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}
