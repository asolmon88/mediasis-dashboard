"use client";

import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { OptionGroupSchema, OptionGroupInput } from "@/lib/FormSchemas/optionGroupSchema";
import { Button } from "@/components/ui/button";
import { UnsavedChangesBar } from "@/components/forms/UnsavedChangesBar";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { AddButton } from "@/components/add-button";
import { ReorderDialog } from "@/components/products-page/ReorderDialog";
import { OptionCard } from "@/components/products-page/OptionFields";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type OptionGroupFormProps = {
  defaultValues?: Partial<OptionGroupInput>;
  onSubmit: (data: OptionGroupInput) => Promise<{ success: boolean; message?: string }>;
  locations: { business_location_id: string; short_name: string }[];
  submitLabel?: string;
  backUrl?: string;
};

export function OptionGroupForm({
  defaultValues,
  onSubmit,
  locations,
  submitLabel = "Guardar",
  backUrl,
}: OptionGroupFormProps) {
  const router = useRouter();

  const form = useForm<OptionGroupInput>({
    resolver: zodResolver(OptionGroupSchema),
    defaultValues: {
      name: "",
      kind: "side",
      options: [],
      ...defaultValues,
    },
  });

  const { control, handleSubmit, setValue, formState: { isSubmitting } } = form;

  const {
    fields: optionFields,
    append: appendOption,
    remove: removeOption,
    replace: replaceOptions,
  } = useFieldArray({ control, name: "options" });

  const optionValues = useWatch({ control, name: "options" }) ?? [];

  const defaultOption = {
    name: "",
    type: "text" as const,
    required: false,
    enable_quantity: false,
    choices: [],
    validation: undefined,
  };

  const handleFormSubmit = async (data: OptionGroupInput) => {
    console.log("[OptionGroupForm] submit data:", JSON.stringify(data, null, 2));
    const result = await onSubmit(data);
    if (result.success) {
      toast.success("Grupo guardado");
      if (backUrl) router.push(backUrl);
    } else {
      toast.error(result.message ?? "Error al guardar");
    }
  };

  const onInvalid = (errors: unknown) => {
    console.error("[OptionGroupForm] validation errors:", JSON.stringify(errors, null, 2));
    toast.error("Hay campos con errores. Por favor revísalos antes de continuar.");
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit, onInvalid)} className="space-y-6">
      <UnsavedChangesBar dirty={form.formState.isDirty} saving={isSubmitting} onDiscard={() => form.reset()} />
      <div className="grid grid-cols-1 gap-4">
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel>Nombre del grupo</FieldLabel>
              <Input placeholder="Ej: Bebidas, Acompañamientos…" {...field} />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="kind"
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel>Tipo</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="side">Acompañamiento</SelectItem>
                  <SelectItem value="extra">Extra</SelectItem>
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Opciones</h3>

        {optionFields.map((field, i) => (
          <OptionCard
            key={field.id}
            index={i}
            control={control}
            remove={removeOption}
            setValue={setValue}
            locations={locations}
          />
        ))}

        <div className={optionFields.length > 0 ? "grid grid-cols-1 md:grid-cols-2 gap-2" : ""}>
          <AddButton
            label="Agregar opción"
            onClick={() => appendOption(defaultOption)}
          />
          {optionFields.length > 1 && (
            <ReorderDialog
              title="Cambiar secuencia de opciones"
              triggerLabel="Cambiar secuencia"
              items={optionFields.map((f, i) => ({
                id: f.id,
                name: (optionValues[i] as { name?: string })?.name ?? "",
                sequence: i + 1,
              }))}
              getId={(item) => item.id}
              getLabel={(item, index) => item.name?.trim() !== "" ? item.name : `Opción ${index + 1}`}
              onSave={(newItems) => {
                const idToOption = new Map(
                  (optionValues as { name?: string }[]).map((opt, i) => [optionFields[i].id, opt])
                );
                const sorted = newItems.map((item) => idToOption.get(item.id) ?? {});
                replaceOptions(sorted as OptionGroupInput["options"] & object[]);
              }}
            />
          )}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        {backUrl && (
          <Button type="button" variant="outline" onClick={() => router.push(backUrl)}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
