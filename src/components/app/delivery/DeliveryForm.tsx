"use client";

import * as React from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlignLeft,
  CheckSquare2,
  CircleDot,
  Info,
  GripVertical,
  Loader2Icon,
  Plus,
  Trash2,
  TypeIcon,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { DeliveryInput, DeliverySchema } from "@/lib/FormSchemas/deliverySchema";
import { CheckoutOptionSchema } from "@/lib/FormSchemas/checkoutSchema";
import { upsertDeliveryMethod } from "@/app/admin/app/delivery/[delivery_method_id]/actions";
import { formatMinutesHuman } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useBusinessLocations } from "@/stores/location-store";
import { restrictedDefaultLocationIds } from "@/lib/dashboard/location-scope";

import { Button } from "@/components/ui/button";
import { UnsavedChangesBar } from "@/components/forms/UnsavedChangesBar";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
  type MultiSelectValue,
} from "@/components/ui/multi-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const optionTypes = ["short_answer", "text", "media", "select", "checkbox"] as const;

const optionLabels: Record<(typeof optionTypes)[number], string> = {
  short_answer: "Respuesta corta",
  text: "Texto",
  media: "Media",
  select: "Selección",
  checkbox: "Opción Múltiple",
};
const pickupReadyOffsetPresets = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

type OptionType = (typeof optionTypes)[number];

function getDefaultOption(type: OptionType) {
  if (type === "short_answer") {
    return { type, question: "", description: "", required: true };
  }
  if (type === "text") {
    return { type, text: "" };
  }
  if (type === "media") {
    return { type, question: "", description: "", required: true };
  }
  if (type === "select") {
    return {
      type,
      question: "",
      description: "",
      required: true,
      choices: [{ name: "", price: 0 }],
    };
  }
  return {
    type,
    question: "",
    description: "",
    required: true,
    choices: [{ name: "", price: 0 }],
    validation: { type: "not_applicable" as const },
  };
}

type ChoiceFieldProps = {
  control: any;
  parentName: string;
};

type SortableChoiceProps = {
  fieldId: string;
  index: number;
  control: any;
  parentName: string;
  onRemove: () => void;
};

function SortableChoice({
  fieldId,
  index,
  control,
  parentName,
  onRemove,
}: SortableChoiceProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fieldId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button
        type="button"
        className="p-1 text-muted-foreground"
        aria-label="Mover opción"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <Controller
        name={`${parentName}.${index}.name` as const}
        control={control}
        render={({ field, fieldState }) => (
          <Field className="flex-1" data-invalid={fieldState.invalid}>
            <Input {...field} placeholder="Opción" aria-invalid={fieldState.invalid} />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
      <Controller
        name={`${parentName}.${index}.price` as const}
        control={control}
        render={({ field, fieldState }) => (
          <Field className="w-32" data-invalid={fieldState.invalid}>
            <Input
              {...field}
              type="number"
              inputMode="decimal"
              aria-invalid={fieldState.invalid}
              onChange={(e) => field.onChange(Number(e.target.value))}
              placeholder="0"
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Eliminar opción"
        className="text-muted-foreground"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function ChoicesList({ control, parentName }: ChoiceFieldProps) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: parentName,
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = fields.findIndex((item) => item.id === active.id);
    const newIndex = fields.findIndex((item) => item.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      move(oldIndex, newIndex);
    }
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-3">
          {fields.map((choice, idx) => (
            <SortableChoice
              key={choice.id}
              fieldId={choice.id}
              index={idx}
              control={control}
              parentName={parentName}
              onRemove={() => remove(idx)}
            />
          ))}
        </div>
      </SortableContext>
      <Button type="button" variant="outline" onClick={() => append({ name: "", price: 0 })}>
        Agregar opción
      </Button>
    </DndContext>
  );
}

type OptionItem = z.infer<typeof CheckoutOptionSchema>;

type OptionCardProps = {
  id: string;
  option: OptionItem;
  index: number;
  control: any;
  update: (index: number, value: any) => void;
  remove: (index: number) => void;
};

function OptionCard({ id, option, index, control, update, remove }: OptionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const typeIcon =
    option.type === "short_answer"
      ? TypeIcon
      : option.type === "text"
        ? AlignLeft
        : option.type === "media"
          ? Upload
        : option.type === "select"
          ? CircleDot
          : CheckSquare2;

  const handleTypeChange = (nextType: OptionType) => {
    update(index, getDefaultOption(nextType));
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <Card ref={setNodeRef} style={style} className="w-full rounded-2xl">
      <CardContent className="space-y-4">
        <div className="flex items-center justify-center text-muted-foreground">
          <button
            type="button"
            aria-label="Mover pregunta"
            className="p-1"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        </div>

        <FieldGroup className="">
          <Controller
            name={`options.${index}.type` as const}
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={(val) => handleTypeChange(val as OptionType)}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    {React.createElement(typeIcon, { className: "size-4" })}
                    <SelectValue placeholder="Tipo" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {optionTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      <div className="flex items-center gap-2">
                        <span>{optionLabels[t]}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />

          {option.type !== "text" && (
            <Controller
              name={`options.${index}.question` as const}
              control={control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <Input
                    {...field}
                    placeholder="Pregunta"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          )}

          {option.type === "text" && (
            <Controller
              name={`options.${index}.text` as const}
              control={control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <Textarea
                    {...field}
                    placeholder="Texto"
                    aria-invalid={fieldState.invalid}
                    rows={4}
                    className="resize-none"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          )}

          {option.type !== "text" && (
            <Controller
              name={`options.${index}.description` as const}
              control={control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel className="text-muted-foreground">Añadir descripción</FieldLabel>
                  <Textarea
                    {...field}
                    placeholder="Descripción"
                    aria-invalid={fieldState.invalid}
                    rows={3}
                    className="resize-none"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          )}

          {(option.type === "select" || option.type === "checkbox") && (
            <div className="space-y-2">
              <FieldLabel>Opciones</FieldLabel>
              <ChoicesList control={control} parentName={`options.${index}.choices`} />
            </div>
          )}

          {option.type === "checkbox" && (
            <div className="space-y-2">
              <FieldLabel>Validación</FieldLabel>
              <Controller
                name={`options.${index}.validation.type` as const}
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(val) => field.onChange(val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_applicable">No aplica</SelectItem>
                      <SelectItem value="select_at_least">Seleccionar al menos</SelectItem>
                      <SelectItem value="select_at_most">Seleccionar máximo</SelectItem>
                      <SelectItem value="select_between">Seleccionar entre</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />

              {(option.validation?.type === "select_at_least" || option.validation?.type === "select_between") && (
                <Controller
                  name={`options.${index}.validation.min` as const}
                  control={control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        aria-invalid={fieldState.invalid}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        placeholder="Mínimo"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              )}

              {(option.validation?.type === "select_at_most" || option.validation?.type === "select_between") && (
                <Controller
                  name={`options.${index}.validation.max` as const}
                  control={control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <Input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        aria-invalid={fieldState.invalid}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        placeholder="Máximo"
                      />
                      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                    </Field>
                  )}
                />
              )}
            </div>
          )}
        </FieldGroup>

        <div className="flex items-center justify-between">
          {option.type !== "text" && (
            <div className="flex items-center gap-2 text-sm">
              <Controller
                name={`options.${index}.required` as const}
                control={control}
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
              <span>Obligatorio</span>
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => remove(index)}
            aria-label="Eliminar pregunta"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type ExpressFormProps = {
  deliveryMethodId: string;
  recordId?: string;
  defaultValues?: Partial<DeliveryInput>;
  paymentMethods: { id: string; name: string }[];
  canManageAllLocations?: boolean;
  scopeLocked?: boolean;
  canUseMediasisCourier?: boolean;
};

export default function ExpressForm({
  deliveryMethodId,
  recordId,
  defaultValues = {},
  paymentMethods,
  canManageAllLocations = true,
  scopeLocked = false,
  canUseMediasisCourier = true,
}: ExpressFormProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const businessLocations = useBusinessLocations();
  const initializedRestrictedLocations = React.useRef(false);
  const [availableEverywhere, setAvailableEverywhere] = React.useState(
    scopeLocked || canManageAllLocations
  );

  const form = useForm<DeliveryInput>({
    resolver: zodResolver(DeliverySchema),
    defaultValues: {
      visibility: true,
      name: "",
      instructions: "",
      pickup_ready_offset_minutes: 5,
      min_order_value: 0,
      free_delivery_value: 0,
      require_location: false,
      require_courier: false,
      payment_methods: [],
      business_location_id: [],
      options: [],
      delivery_method_id: deliveryMethodId,
      ...defaultValues,
    } as DeliveryInput,
  });

  React.useEffect(() => {
    form.setValue("delivery_method_id", deliveryMethodId);
  }, [deliveryMethodId, form]);

  React.useEffect(() => {
    const current = defaultValues.business_location_id ?? form.getValues("business_location_id") ?? [];
    // Restricted members never infer "all locations" from an empty visible
    // list: that list may be empty because protected assignments were removed
    // server-side. Only an explicitly locked existing all-scope method renders
    // as available everywhere.
    setAvailableEverywhere(scopeLocked || (canManageAllLocations && (current as string[]).length === 0));
  }, [canManageAllLocations, defaultValues.business_location_id, form, scopeLocked]);

  React.useEffect(() => {
    if (!canManageAllLocations && !recordId && businessLocations.length && !initializedRestrictedLocations.current) {
      initializedRestrictedLocations.current = true;
      form.setValue("business_location_id", restrictedDefaultLocationIds(businessLocations));
    }
  }, [businessLocations, canManageAllLocations, form, recordId]);

  const { fields, append, update, remove, move } = useFieldArray({
    control: form.control,
    name: "options",
  });

  const pickupReadyOffsetMinutes = form.watch("pickup_ready_offset_minutes");
  const requiresCourier = form.watch("require_courier");

  React.useEffect(() => {
    if (requiresCourier) form.setValue("require_location", true);
  }, [form, requiresCourier]);

  const addOption = (type: OptionType) => {
    append(getDefaultOption(type));
  };

  async function onSubmit(data: DeliveryInput) {
    setLoading(true);
    const parsed = DeliverySchema.safeParse(data);
    if (!parsed.success) {
      toast.error(`Error al procesar los datos: ${parsed.error}`);
      setLoading(false);
      return;
    }

    const result = await upsertDeliveryMethod({
      data: parsed.data,
      recordId,
    });

    if (!result.success) {
      toast.error(result.message ?? "No se pudieron guardar los datos.");
      setLoading(false);
      return;
    }

    toast.success("Datos guardados.");
    setLoading(false);
    router.back();
  }

  const handleCardDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = fields.findIndex((item) => item.id === active.id);
    const newIndex = fields.findIndex((item) => item.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      move(oldIndex, newIndex);
    }
  };

  const watchedOptions = (
    useWatch({
      control: form.control,
      name: "options" as const,
    }) ?? []
  ) as OptionItem[];

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="mb-20 w-full max-w-5xl space-y-4">
      <UnsavedChangesBar dirty={form.formState.isDirty || (canManageAllLocations && availableEverywhere !== (scopeLocked || (defaultValues.business_location_id ?? []).length === 0))} saving={loading} onDiscard={() => {
        form.reset();
        setAvailableEverywhere(scopeLocked || (canManageAllLocations && (defaultValues.business_location_id ?? []).length === 0));
      }} />
      <Card className="w-full rounded-3xl">
        <CardContent className="space-y-6">
          <div className="text-md font-semibold">Express</div>

          <div className="space-y-4">
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Nombre del método</FieldLabel>
                  <Input
                    {...field}
                    placeholder="Ej. Delivery rápido"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="visibility"
              control={form.control}
              render={({ field }) => (
                <div className={`flex items-center gap-3 ${!canUseMediasisCourier ? "text-muted-foreground" : ""}`}>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                  <span className="text-sm">Visible</span>
                </div>
              )}
            />

            <Controller
              name="require_location"
              control={form.control}
              render={({ field }) => (
                <div className="flex items-center gap-3">
                  <Switch checked={field.value} disabled={requiresCourier} onCheckedChange={field.onChange} />
                  <div>
                    <div className="text-sm">Requiere ubicación</div>
                    {requiresCourier ? <div className="text-xs text-muted-foreground">La ubicación es necesaria para asignar el motorizado.</div> : null}
                  </div>
                </div>
              )}
            />

            <Controller
              name="require_courier"
              control={form.control}
              render={({ field }) => (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={field.value}
                    // A business that no longer has Uber access must still be
                    // able to turn an existing courier method off. It simply
                    // cannot turn the setting on again without that access.
                    disabled={!canUseMediasisCourier && !field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      if (checked) form.setValue("require_location", true);
                    }}
                  />
                  <div>
                    <div className="flex items-center gap-1 text-sm">Requiere motorizado de mediasis
                      {!canUseMediasisCourier ? <Tooltip><TooltipTrigger asChild><Info className="size-4 cursor-help" /></TooltipTrigger><TooltipContent>Disponible con la conexión Mediasis Uber.</TooltipContent></Tooltip> : null}
                    </div>
                  </div>
                </div>
              )}
            />

            {!recordId ? (
              <Controller
                name="pickup_ready_offset_minutes"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid} className="space-y-3">
                    <FieldLabel>Tiempo de preparación</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {pickupReadyOffsetPresets.map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          variant={field.value === preset ? "default" : "outline"}
                          size="sm"
                          onClick={() => field.onChange(preset)}
                        >
                          {formatMinutesHuman(preset)}
                        </Button>
                      ))}
                    </div>
                    <div className="max-w-xs">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            field.onChange(undefined);
                            return;
                          }
                          const next = Number(raw);
                          if (!Number.isNaN(next)) {
                            field.onChange(next);
                          }
                        }}
                        aria-invalid={fieldState.invalid}
                        placeholder="Minutos"
                        className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Se usa para calcular pickup_ready_dt en Uber Direct. Actual:{" "}
                      {formatMinutesHuman(
                        Number.isFinite(pickupReadyOffsetMinutes) ? pickupReadyOffsetMinutes : 5
                      )}
                      .
                    </p>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />
            ) : null}

            <Controller
              name="instructions"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Instrucciones</FieldLabel>
                  <Textarea
                    {...field}
                    placeholder="Agregar instrucciones para el cliente"
                    aria-invalid={fieldState.invalid}
                    rows={3}
                    className="resize-none"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="payment_methods"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldLabel>Métodos de pago (opcional)</FieldLabel>
                    {(field.value?.length ?? 0) > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => field.onChange([])}
                      >
                        Dejar sin métodos de pago
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Podés dejarlo vacío si la farmacia coordina el pago directamente.
                  </p>
                  {paymentMethods.length > 0 ? (
                    <MultiSelector
                      values={
                        (field.value || []).map((id: string): MultiSelectValue => ({
                          value: id,
                          label: paymentMethods.find((method) => method.id === id)?.name || id,
                        }))
                      }
                      onValuesChange={(vals) => field.onChange(vals.map((v) => v.value))}
                      loop
                      className="w-full"
                    >
                      <MultiSelectorTrigger>
                        <MultiSelectorInput placeholder="Seleccioná métodos de pago" />
                      </MultiSelectorTrigger>
                      <MultiSelectorContent>
                        <MultiSelectorList>
                          {paymentMethods.map((method) => (
                            <MultiSelectorItem
                              key={method.id}
                              value={method.id}
                              label={method.name}
                            >
                              {method.name}
                            </MultiSelectorItem>
                          ))}
                        </MultiSelectorList>
                      </MultiSelectorContent>
                    </MultiSelector>
                  ) : (
                    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                      Este negocio no tiene métodos de pago configurados. Podés guardar este método de delivery sin seleccionar ninguno.
                    </div>
                  )}
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="business_location_id"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  {canManageAllLocations ? <div className="flex items-center space-x-3">
                    <Checkbox
                      id="available_everywhere"
                      checked={availableEverywhere}
                      disabled={!canManageAllLocations}
                      onCheckedChange={(checked) => {
                        const next = Boolean(checked);
                        setAvailableEverywhere(next);
                        if (next) {
                          field.onChange([]);
                        }
                      }}
                    />
                    <label
                      htmlFor="available_everywhere"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Disponible en todas las ubicaciones
                    </label>
                    {!canManageAllLocations ? (
                      <span className="text-xs text-muted-foreground">
                        Solo administradores con acceso a todos los locales pueden cambiar este alcance.
                      </span>
                    ) : null}
                  </div> : null}

                  {scopeLocked ? (
                    <p className="text-xs text-muted-foreground">
                      Este método está disponible en todas las ubicaciones y ese alcance no puede modificarse desde tu acceso.
                    </p>
                  ) : null}

                  {(!canManageAllLocations || !availableEverywhere) && !scopeLocked && (
                    <div className="mt-3 space-y-2">
                      <FieldLabel>Ubicaciones</FieldLabel>
                      {/*
                        MultiSelector works with {label,value} items, so map string ids to that shape and back.
                      */}
                      <MultiSelector
                        values={
                          (field.value || []).map((id: string): MultiSelectValue => ({
                            value: id,
                            label:
                              businessLocations.find((loc) => loc.business_location_id === id)
                                ?.short_name || id,
                          }))
                        }
                        onValuesChange={(vals) => field.onChange(vals.map((v) => v.value))}
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
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <div className="">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" className="w-full">
              <Plus className="mr-2 size-3" />
              Agregar tarjeta
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-64">
            {optionTypes.map((type) => (
              <DropdownMenuItem key={type} onClick={() => addOption(type)}>
                <div className="flex items-center gap-2">
                  {type === "short_answer" && <TypeIcon className="size-4" />}
                  {type === "text" && <AlignLeft className="size-4" />}
                  {type === "select" && <CircleDot className="size-4" />}
                  {type === "checkbox" && <CheckSquare2 className="size-4" />}
                  {type === "media" && <Upload className="size-4" />}
                  <span>{optionLabels[type]}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DndContext collisionDetection={closestCenter} onDragEnd={handleCardDragEnd}>
        <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {fields.map((field, index) => {
              const option = watchedOptions[index] as OptionItem | undefined;
              if (!option) return null;

              return (
                <OptionCard
                  key={field.id}
                  id={field.id}
                  option={option}
                  index={index}
                  control={form.control}
                  update={update}
                  remove={remove}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex justify-start">
        <Button type="submit" disabled={loading}>
          {!loading ? (
            "Guardar"
          ) : (
            <div className="flex flex-row items-center justify-center gap-2">
              <Loader2Icon className="animate-spin" />
              Guardando
            </div>
          )}
        </Button>
      </div>
    </form>
  );
}
