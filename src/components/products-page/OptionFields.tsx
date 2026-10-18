"use client";

import { useEffect } from "react";
import {
  Controller,
  useFieldArray,
  UseFieldArrayRemove,
  useWatch,
  useController,
  type Control,
  type FieldPath,
  type UseFormSetValue,
} from "react-hook-form";
import { ProductAddInput } from "@/lib/FormSchemas/productAddSchema";
import { ProductEditInput } from "@/lib/FormSchemas/productEditSchema";
import { OptionGroupInput } from "@/lib/FormSchemas/optionGroupSchema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { MarketCurrencyCode } from "@/components/dashboard/MarketCurrencyCode";
import { DecimalMoneyInput } from "@/components/dashboard/DecimalMoneyInput";
import {
  CalendarIcon,
  CheckSquare,
  Circle,
  HashIcon,
  ImageIcon,
  Plus,
  TextIcon,
  Trash2,
  X,
} from "lucide-react";
import { ReorderDialog } from "./ReorderDialog";
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
  type MultiSelectValue,
} from "@/components/ui/multi-select";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

type FormInput = ProductAddInput | ProductEditInput | OptionGroupInput;

type Location = { business_location_id: string; short_name: string };

// ----------------------------------------------------------------
// ChoiceRow — one choice entry. Extracted so useWatch is at top level.
// ----------------------------------------------------------------
export function ChoiceRow<T extends FormInput>({
  index,
  choiceIndex,
  control,
  remove,
  locations = [],
}: {
  index: number;
  choiceIndex: number;
  control: Control<T>;
  remove: (i: number) => void;
  locations?: Location[];
}) {
  const authorization = useDashboardAuthorization();
  const canManageAllLocations = authorization.mode === "legacy" || authorization.allLocations;
  const i = choiceIndex;
  const scopePath = `options.${index}.choices.${i}.scope` as FieldPath<T>;
  const locationIdsPath = `options.${index}.choices.${i}.location_ids` as FieldPath<T>;
  const scope = useWatch({ control, name: scopePath });
  const scopeController = useController({ control, name: scopePath });

  useEffect(() => {
    if (!canManageAllLocations && scope !== "specific") {
      scopeController.field.onChange("specific");
    }
  }, [canManageAllLocations, scope, scopeController.field]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Controller
          name={`options.${index}.choices.${i}.name` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <Input placeholder={`Elección ${i + 1} nombre`} {...(field as object)} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name={`options.${index}.choices.${i}.price` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <div className="relative w-[150px]">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"><MarketCurrencyCode /></span>
                <DecimalMoneyInput
                  value={(field.value as number) ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  className="pl-7"
                />
              </div>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)}>
          <X className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      {locations.length > 0 && (
        <>
          {canManageAllLocations ? <Controller
            name={scopePath}
            control={control}
            render={({ field: scopeField }) => (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`choice-all-${index}-${i}`}
                  checked={(scopeField.value as string | undefined) !== "specific"}
                  onCheckedChange={(checked) => {
                    scopeField.onChange(checked ? "all" : "specific");
                  }}
                  disabled={!canManageAllLocations}
                />
                <label
                  htmlFor={`choice-all-${index}-${i}`}
                  className="text-sm font-medium leading-none"
                >
                  Disponible en todas las ubicaciones
                </label>
              </div>
            )}
          /> : null}

          {(!canManageAllLocations || scope === "specific") && (
            <Controller
              name={locationIdsPath}
              control={control}
              render={({ field: locationField }) => {
                const selectedIds: string[] = (locationField.value as string[]) ?? [];
                const selectedValues: MultiSelectValue[] = locations
                  .filter((l) => selectedIds.includes(l.business_location_id))
                  .map((l) => ({ value: l.business_location_id, label: l.short_name }));
                return (
                  <MultiSelector
                    values={selectedValues}
                    onValuesChange={(vals) =>
                      locationField.onChange(vals.map((v) => v.value))
                    }
                    loop
                  >
                    <MultiSelectorTrigger>
                      <MultiSelectorInput placeholder="Selecciona ubicaciones disponibles" />
                    </MultiSelectorTrigger>
                    <MultiSelectorContent>
                      <MultiSelectorList>
                        {locations.map((loc) => (
                          <MultiSelectorItem
                            key={loc.business_location_id}
                            value={loc.business_location_id}
                            label={loc.short_name}
                          >
                            {loc.short_name}
                          </MultiSelectorItem>
                        ))}
                      </MultiSelectorList>
                    </MultiSelectorContent>
                  </MultiSelector>
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// ChoicesField — list of choices for an option
// ----------------------------------------------------------------
export function ChoicesField<T extends FormInput>({
  index,
  control,
  locations = [],
}: {
  index: number;
  control: Control<T>;
  locations?: Location[];
}) {
  const authorization = useDashboardAuthorization();
  const canManageAllLocations = authorization.mode === "legacy" || authorization.allLocations;
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: `options.${index}.choices` as never,
  });

  const choiceValues = (useWatch({ control, name: `options.${index}.choices` as never }) ?? []) as { name?: string }[];

  return (
    <div className="space-y-3">
      {fields.map((choice, i) => (
        <ChoiceRow
          key={choice.id}
          index={index}
          choiceIndex={i}
          control={control}
          remove={remove}
          locations={locations}
        />
      ))}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          variant="ghost"
          className="text-sm flex items-center gap-2"
          onClick={() => (append as (v: unknown) => void)({
            name: "",
            price: 0,
            scope: canManageAllLocations ? "all" : "specific",
            sequence: fields.length + 1,
            location_ids: !canManageAllLocations
              ? locations.map((location) => location.business_location_id)
              : [],
          })}
        >
          <Plus className="h-4 w-4" />
          Agregar elección
        </Button>
        {fields.length > 1 && (
          <ReorderDialog
            title="Secuencia de elecciones"
            triggerLabel="Cambiar secuencia"
            items={fields}
            getId={(item) => item.id}
            getLabel={(item, i) => (item as { name?: string }).name?.trim() || `Elección ${i + 1}`}
            onSave={(newItems) => {
              const sorted = newItems.map((item, i) => {
                const origIdx = fields.findIndex((f) => f.id === item.id);
                return { ...(choiceValues[origIdx] as object), sequence: i + 1 };
              });
              (replace as (v: unknown[]) => void)(sorted);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// ValidationLimitsFields — min/max inputs for checkbox validation
// ----------------------------------------------------------------
export function ValidationLimitsFields<T extends FormInput>({
  index,
  control,
}: {
  index: number;
  control: Control<T>;
}) {
  const validationType = useWatch({
    control,
    name: `options.${index}.validation.type` as FieldPath<T>,
  });

  if (!validationType || validationType === "not_applicable") return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {(validationType === "select_at_least" || validationType === "select_between") && (
        <Controller
          name={`options.${index}.validation.min` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel>Al menos</FieldLabel>
              <Input
                type="text"
                inputMode="numeric"
                value={(field.value as number) ?? 0}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") { field.onChange(0); return; }
                  const num = Number(raw);
                  if (!isNaN(num)) field.onChange(num);
                }}
                min={1}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      )}
      {(validationType === "select_at_most" || validationType === "select_between") && (
        <Controller
          name={`options.${index}.validation.max` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel>A lo sumo</FieldLabel>
              <Input
                type="text"
                inputMode="numeric"
                value={(field.value as number) ?? 0}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") { field.onChange(0); return; }
                  const num = Number(raw);
                  if (!isNaN(num)) field.onChange(num);
                }}
                min={1}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// OptionCard — full option editor card
// ----------------------------------------------------------------
export function OptionCard<T extends FormInput>({
  index,
  control,
  remove,
  setValue,
  locations = [],
}: {
  index: number;
  control: Control<T>;
  remove: UseFieldArrayRemove;
  setValue: UseFormSetValue<T>;
  locations?: Location[];
}) {
  const authorization = useDashboardAuthorization();
  const canManageAllLocations = authorization.mode === "legacy" || authorization.allLocations;
  const { fields: choices } = useFieldArray({
    control,
    name: `options.${index}.choices` as never,
  });

  const type = useWatch({ control, name: `options.${index}.type` as FieldPath<T> });
  const validation = useWatch({ control, name: `options.${index}.validation` as FieldPath<T> });

  useEffect(() => {
    if (type === "checkbox" || type === "selection") {
      if (!choices || choices.length === 0) {
        (setValue as (name: string, value: unknown, opts?: object) => void)(
          `options.${index}.choices`,
          [{ name: "", price: 0, scope: canManageAllLocations ? "all" : "specific", sequence: 0, location_ids: [] }],
          { shouldValidate: true, shouldDirty: true },
        );
      }
      if (type === "selection") {
        (setValue as (name: string, value: unknown) => void)(`options.${index}.validation`, undefined);
      }
    } else if (type && !["checkbox", "selection"].includes(type as string)) {
      (setValue as (name: string, value: unknown) => void)(`options.${index}.choices`, []);
      (setValue as (name: string, value: unknown) => void)(`options.${index}.validation`, undefined);
    }

    if (type === "checkbox" && !(validation as { type?: string } | undefined)?.type) {
      (setValue as (name: string, value: unknown, opts?: object) => void)(
        `options.${index}.validation`,
        { type: "not_applicable" },
        { shouldValidate: true, shouldDirty: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, (validation as { type?: string } | undefined)?.type, canManageAllLocations]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{`Opción ${index + 1}`}</CardTitle>
        <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <Controller
          name={`options.${index}.name` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel>Nombre</FieldLabel>
              <Input placeholder="Nombre" {...(field as object)} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name={`options.${index}.type` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <Select value={field.value as string} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione un tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">
                    <div className="flex items-center gap-2"><TextIcon className="h-4 w-4" />Texto</div>
                  </SelectItem>
                  <SelectItem value="number">
                    <div className="flex items-center gap-2"><HashIcon className="h-4 w-4" />Número</div>
                  </SelectItem>
                  <SelectItem value="date">
                    <div className="flex items-center gap-2"><CalendarIcon className="h-4 w-4" />Fecha</div>
                  </SelectItem>
                  <SelectItem value="checkbox">
                    <div className="flex items-center gap-2"><CheckSquare className="h-4 w-4" />Elección múltiple</div>
                  </SelectItem>
                  <SelectItem value="selection">
                    <div className="flex items-center gap-2"><Circle className="h-4 w-4" />Elección única</div>
                  </SelectItem>
                  <SelectItem value="media">
                    <div className="flex items-center gap-2"><ImageIcon className="h-4 w-4" />Imagen</div>
                  </SelectItem>
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name={`options.${index}.required` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <div className="flex items-center space-x-2 mt-2">
                <Checkbox
                  checked={!!(field.value)}
                  onCheckedChange={(checked) => field.onChange(!!checked)}
                  id={`required-${index}`}
                />
                <label htmlFor={`required-${index}`} className="text-sm font-medium leading-none">
                  Requerido
                </label>
              </div>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        {["checkbox", "selection"].includes(type as string) && (
          <div className="space-y-4 border-t pt-4">
            <Controller
              name={`options.${index}.enable_quantity` as FieldPath<T>}
              control={control}
              render={({ field, fieldState }) => (
                <Field>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={!!field.value}
                      onCheckedChange={(checked) => field.onChange(!!checked)}
                      id={`enable-quantity-${index}`}
                    />
                    <label htmlFor={`enable-quantity-${index}`} className="text-sm font-medium leading-none">
                      Permitir cantidad
                    </label>
                  </div>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <ChoicesField index={index} control={control} locations={locations} />

            {type === "checkbox" && (
              <div className="space-y-3 border-t pt-4">
                <Controller
                  name={`options.${index}.validation.type` as FieldPath<T>}
                  control={control}
                  render={({ field, fieldState }) => (
                    <Field>
                      <FieldLabel>Validación</FieldLabel>
                      <Select
                        value={(field.value as string) ?? "not_applicable"}
                        onValueChange={(val) => {
                          field.onChange(val);
                          const setV = setValue as (name: string, value: unknown) => void;
                          if (val === "not_applicable") setV(`options.${index}.validation`, { type: "not_applicable" });
                          else if (val === "select_at_least") setV(`options.${index}.validation`, { type: "select_at_least", min: 1 });
                          else if (val === "select_at_most") setV(`options.${index}.validation`, { type: "select_at_most", max: 1 });
                          else if (val === "select_between") setV(`options.${index}.validation`, { type: "select_between", min: 1, max: 2 });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar validación" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_applicable">No aplica</SelectItem>
                          <SelectItem value="select_at_least">Seleccionar al menos</SelectItem>
                          <SelectItem value="select_at_most">Seleccionar a lo sumo</SelectItem>
                          <SelectItem value="select_between">Seleccionar entre</SelectItem>
                        </SelectContent>
                      </Select>
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
                <ValidationLimitsFields index={index} control={control} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
