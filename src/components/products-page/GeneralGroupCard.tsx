"use client";

import { useEffect } from "react";
import {
  Controller,
  useFieldArray,
  UseFieldArrayRemove,
  useForm,
  UseFormSetValue,
  useWatch,
  type Control,
  type FieldPath,
} from "react-hook-form";
import { ProductAddInput } from "@/lib/FormSchemas/productAddSchema";
import { ProductEditInput } from "@/lib/FormSchemas/productEditSchema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
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
import { AddButton } from "@/components/add-button";
import { ReorderDialog } from "./ReorderDialog";
import { Badge } from "@/components/ui/badge";

type FormInput = ProductAddInput | ProductEditInput;

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------
type GroupCardProps<T extends FormInput> = {
  groupIndex: number;
  control: Control<T>;
  remove: UseFieldArrayRemove;
  setValue: UseFormSetValue<T>;
};

// ----------------------------------------------------------------
// Nested ChoicesField for a group option
// ----------------------------------------------------------------
function GroupChoicesField<T extends FormInput>({
  groupIndex,
  optionIndex,
  control,
}: {
  groupIndex: number;
  optionIndex: number;
  control: Control<T>;
}) {
  const name = `general_option_groups.${groupIndex}.options.${optionIndex}.choices` as FieldPath<T>;
  const { fields, append, remove } = useFieldArray({ control, name: name as never });

  return (
    <div className="space-y-3">
      {fields.map((choice, i) => (
        <div key={choice.id} className="flex items-center gap-2">
          <Controller
            name={`general_option_groups.${groupIndex}.options.${optionIndex}.choices.${i}.name` as FieldPath<T>}
            control={control}
            render={({ field, fieldState }) => (
              <Field>
                <Input placeholder={`Elección ${i + 1} nombre`} {...(field as object)} />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          <Controller
            name={`general_option_groups.${groupIndex}.options.${optionIndex}.choices.${i}.price` as FieldPath<T>}
            control={control}
            render={({ field, fieldState }) => (
              <Field>
                <div className="relative w-[150px]">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"><MarketCurrencyCode /></span>
                  <DecimalMoneyInput
                    value={(field as { value: number }).value ?? ""}
                    onChange={(field as { onChange: (v: number) => void }).onChange}
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
      ))}
      <Button
        type="button"
        variant="ghost"
        className="text-sm flex items-center gap-2"
        onClick={() => (append as (v: unknown) => void)({ name: "", price: 0 })}
      >
        <Plus className="h-4 w-4" />
        Agregar elección
      </Button>
    </div>
  );
}

// ----------------------------------------------------------------
// Nested ValidationLimitsFields for a group option
// ----------------------------------------------------------------
function GroupValidationLimitsFields<T extends FormInput>({
  groupIndex,
  optionIndex,
  control,
}: {
  groupIndex: number;
  optionIndex: number;
  control: Control<T>;
}) {
  const validationType = useWatch({
    control,
    name: `general_option_groups.${groupIndex}.options.${optionIndex}.validation.type` as FieldPath<T>,
  });

  if (!validationType || validationType === "not_applicable") return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {(validationType === "select_at_least" || validationType === "select_between") && (
        <Controller
          name={`general_option_groups.${groupIndex}.options.${optionIndex}.validation.min` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel>Al menos</FieldLabel>
              <Input
                type="text"
                inputMode="numeric"
                value={(field as { value: number }).value ?? 0}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") { (field as { onChange: (v: number) => void }).onChange(0); return; }
                  const num = Number(raw);
                  if (!isNaN(num)) (field as { onChange: (v: number) => void }).onChange(num);
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
          name={`general_option_groups.${groupIndex}.options.${optionIndex}.validation.max` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel>A lo sumo</FieldLabel>
              <Input
                type="text"
                inputMode="numeric"
                value={(field as { value: number }).value ?? 0}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") { (field as { onChange: (v: number) => void }).onChange(0); return; }
                  const num = Number(raw);
                  if (!isNaN(num)) (field as { onChange: (v: number) => void }).onChange(num);
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
// Single option card inside a group
// ----------------------------------------------------------------
function GroupOptionCard<T extends FormInput>({
  groupIndex,
  optionIndex,
  control,
  remove,
  setValue,
}: {
  groupIndex: number;
  optionIndex: number;
  control: Control<T>;
  remove: UseFieldArrayRemove;
  setValue: UseFormSetValue<T>;
}) {
  const typePath = `general_option_groups.${groupIndex}.options.${optionIndex}.type` as FieldPath<T>;
  const validationPath = `general_option_groups.${groupIndex}.options.${optionIndex}.validation` as FieldPath<T>;
  const choicesPath = `general_option_groups.${groupIndex}.options.${optionIndex}.choices` as FieldPath<T>;

  const type = useWatch({ control, name: typePath });
  const validation = useWatch({ control, name: validationPath });

  useEffect(() => {
    if (type === "checkbox" || type === "selection") {
      const choices = (setValue as unknown as (name: string) => unknown)(choicesPath);
      if (!choices || (Array.isArray(choices) && choices.length === 0)) {
        (setValue as unknown as (name: string, value: unknown, opts: object) => void)(
          choicesPath, [{ name: "", price: 0 }], { shouldValidate: true, shouldDirty: true }
        );
      }
    } else if (type && !["checkbox", "selection"].includes(type as string)) {
      (setValue as unknown as (name: string, value: unknown) => void)(choicesPath, []);
      (setValue as unknown as (name: string, value: unknown) => void)(validationPath, undefined);
    }
    if (type === "checkbox" && !(validation as { type?: string } | undefined)?.type) {
      (setValue as unknown as (name: string, value: unknown, opts: object) => void)(
        validationPath, { type: "not_applicable" }, { shouldValidate: true, shouldDirty: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, (validation as { type?: string } | undefined)?.type]);

  return (
    <Card className="border border-muted">
      <CardHeader className="flex flex-row items-center justify-between py-3">
        <CardTitle className="text-sm">{`Opción ${optionIndex + 1}`}</CardTitle>
        <Button type="button" variant="ghost" size="icon" onClick={() => remove(optionIndex)}>
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Controller
          name={`general_option_groups.${groupIndex}.options.${optionIndex}.name` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel>Nombre</FieldLabel>
              <Input placeholder="Nombre de la opción" {...(field as object)} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name={typePath}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <Select value={(field as { value: string }).value} onValueChange={(field as { onChange: (v: string) => void }).onChange}>
                <SelectTrigger><SelectValue placeholder="Seleccione un tipo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text"><div className="flex items-center gap-2"><TextIcon className="h-4 w-4" />Texto</div></SelectItem>
                  <SelectItem value="number"><div className="flex items-center gap-2"><HashIcon className="h-4 w-4" />Número</div></SelectItem>
                  <SelectItem value="date"><div className="flex items-center gap-2"><CalendarIcon className="h-4 w-4" />Fecha</div></SelectItem>
                  <SelectItem value="checkbox"><div className="flex items-center gap-2"><CheckSquare className="h-4 w-4" />Elección múltiple</div></SelectItem>
                  <SelectItem value="selection"><div className="flex items-center gap-2"><Circle className="h-4 w-4" />Elección única</div></SelectItem>
                  <SelectItem value="media"><div className="flex items-center gap-2"><ImageIcon className="h-4 w-4" />Imagen</div></SelectItem>
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name={`general_option_groups.${groupIndex}.options.${optionIndex}.required` as FieldPath<T>}
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <div className="flex items-center space-x-2 mt-2">
                <Checkbox
                  checked={!!(field as { value: boolean }).value}
                  onCheckedChange={(checked) => (field as { onChange: (v: boolean) => void }).onChange(!!checked)}
                  id={`group-${groupIndex}-required-${optionIndex}`}
                />
                <label htmlFor={`group-${groupIndex}-required-${optionIndex}`} className="text-sm font-medium leading-none">
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
              name={`general_option_groups.${groupIndex}.options.${optionIndex}.enable_quantity` as FieldPath<T>}
              control={control}
              render={({ field, fieldState }) => (
                <Field>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      checked={!!(field as { value: boolean }).value}
                      onCheckedChange={(checked) => (field as { onChange: (v: boolean) => void }).onChange(!!checked)}
                      id={`group-${groupIndex}-eq-${optionIndex}`}
                    />
                    <label htmlFor={`group-${groupIndex}-eq-${optionIndex}`} className="text-sm font-medium leading-none">
                      Permitir cantidad
                    </label>
                  </div>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <GroupChoicesField groupIndex={groupIndex} optionIndex={optionIndex} control={control} />

            {type === "checkbox" && (
              <div className="space-y-3 border-t pt-4">
                <Controller
                  name={`general_option_groups.${groupIndex}.options.${optionIndex}.validation.type` as FieldPath<T>}
                  control={control}
                  render={({ field, fieldState }) => (
                    <Field>
                      <FieldLabel>Validación</FieldLabel>
                      <Select
                        value={(field as { value: string }).value ?? "not_applicable"}
                        onValueChange={(val) => {
                          (field as { onChange: (v: string) => void }).onChange(val);
                          const setV = setValue as unknown as (name: string, value: unknown) => void;
                          if (val === "not_applicable") setV(validationPath, { type: "not_applicable" });
                          else if (val === "select_at_least") setV(validationPath, { type: "select_at_least", min: 1 });
                          else if (val === "select_at_most") setV(validationPath, { type: "select_at_most", max: 1 });
                          else if (val === "select_between") setV(validationPath, { type: "select_between", min: 1, max: 2 });
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Seleccionar validación" /></SelectTrigger>
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
                <GroupValidationLimitsFields groupIndex={groupIndex} optionIndex={optionIndex} control={control} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------
// GeneralGroupCard — one general group with its inline option editor
// ----------------------------------------------------------------
export function GeneralGroupCard<T extends FormInput>({
  groupIndex,
  control,
  remove,
  setValue,
}: GroupCardProps<T>) {
  const optionsFieldName = `general_option_groups.${groupIndex}.options` as FieldPath<T>;
  const {
    fields: optionFields,
    append: appendOption,
    remove: removeOption,
    replace: replaceOptions,
  } = useFieldArray({ control, name: optionsFieldName as never });

  const groupNamePath = `general_option_groups.${groupIndex}.name` as FieldPath<T>;
  const optionValues = useWatch({ control, name: optionsFieldName }) as { name?: string; sequence?: number }[] ?? [];

  const dialogItems = optionFields.map((field, i) => ({
    id: field.id,
    name: optionValues[i]?.name ?? "",
    sequence: optionValues[i]?.sequence ?? i + 1,
  }));

  const defaultOption = {
    name: "",
    sequence: optionFields.length + 1,
    type: "text",
    required: false,
    enable_quantity: false,
    choices: [],
    validation: undefined,
  };

  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2 flex-1">
          <Badge variant="secondary">general</Badge>
          <Controller
            name={groupNamePath}
            control={control}
            render={({ field, fieldState }) => (
              <Field className="flex-1 mb-0">
                <Input
                  placeholder="Nombre del grupo"
                  {...(field as object)}
                  className="font-medium"
                />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => remove(groupIndex)}>
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {optionFields.length === 0 && (
          <AddButton
            label="Agregar opción"
            onClick={() => (appendOption as (v: unknown) => void)(defaultOption)}
          />
        )}

        {optionFields.map((field, optionIndex) => (
          <GroupOptionCard
            key={field.id}
            groupIndex={groupIndex}
            optionIndex={optionIndex}
            control={control}
            remove={removeOption}
            setValue={setValue}
          />
        ))}

        {optionFields.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <AddButton
              label="Agregar opción"
              onClick={() => (appendOption as (v: unknown) => void)(defaultOption)}
            />
            <ReorderDialog
              title="Cambiar secuencia de opciones"
              triggerLabel="Cambiar secuencia"
              items={dialogItems}
              getId={(item) => item.id}
              getLabel={(item, index) => item.name?.trim() !== "" ? item.name : `Opción ${index + 1}`}
              onSave={(newItems) => {
                const currentValues = (optionValues ?? []) as typeof optionValues;
                const idToOption = new Map(
                  currentValues.map((opt, i) => [optionFields[i].id, opt])
                );
                const sorted = newItems.map((item, i) => ({
                  ...(idToOption.get(item.id) ?? {}),
                  sequence: i + 1,
                }));
                (replaceOptions as (v: unknown) => void)(sorted);
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
