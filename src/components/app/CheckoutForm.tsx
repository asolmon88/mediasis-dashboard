"use client"

import * as React from "react"
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { CheckoutInput, CheckoutSchema } from "@/lib/FormSchemas/checkoutSchema"
import { Button } from "@/components/ui/button"
import { UnsavedChangesBar } from "@/components/forms/UnsavedChangesBar"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider"
import { hasMarketCapability } from "@/lib/dashboard/market"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  AlignLeft,
  CircleDot,
  CheckSquare2,
  GripVertical,
  TextCursorInput,
  Trash2,
  Plus,
  TypeIcon,
  Loader2Icon,
  Upload,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { upsertCheckoutData } from "@/app/admin/app/actions"
import { getCheckoutCardsData } from "@/app/admin/app/checkout/actions"
import { useActiveLocationId } from "@/stores/location-store"
import LoyaltyProgramConfigForm, {
  type LoyaltyProgramConfigFormHandle,
} from "./LoyaltyProgramConfigForm"

const optionTypes = ["short_answer", "text", "media", "select", "checkbox"] as const

const optionLabels: Record<(typeof optionTypes)[number], string> = {
  short_answer: "Respuesta corta",
  text: "Texto",
  media: "Media",
  select: "Selección",
  checkbox: "Opción Múltiple",
}

type OptionType = (typeof optionTypes)[number]

const optionIcons: Record<OptionType, React.ComponentType<{ className?: string }>> = {
  short_answer: TypeIcon,
  text: AlignLeft,
  media: Upload,
  select: CircleDot,
  checkbox: CheckSquare2,
}

/**
 * 
 * @param type The type of the option you want to get the default value of
 * @returns the default for the inputs of the options that will later be modified by the user
 */
function getDefaultOption(type: OptionType) {
  if (type === "short_answer") {
    return { type, question: "", description: "", required: true }
  }
  if (type === "text") {
    return { type, text: "" }
  }
  if (type === "media") {
    return { type, question: "", description: "", required: true }
  }
  if (type === "select") {
    return {
      type,
      question: "",
      description: "",
      required: true,
      choices: [{ name: "", price: 0 }],
    }
  }
  return {
    type,
    question: "",
    description: "",
    required: true,
    choices: [{ name: "", price: 0 }],
    validation: { type: "not_applicable" as const },
  }
}

type ChoiceFieldProps = {
  control: any
  parentName: string
}

type SortableChoiceProps = {
  fieldId: string
  index: number
  control: any
  parentName: string
  onRemove: () => void
}

/**
 * Sortable choice for the checkbox or selection types of options.
 */
function SortableChoice({ fieldId, index, control, parentName, onRemove }: SortableChoiceProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fieldId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  }

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
  )
}

/**
 * The list of choices from the selection or checkbox options
 */
function ChoicesList({ control, parentName }: ChoiceFieldProps) {
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: parentName,
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = fields.findIndex((item) => item.id === active.id)
    const newIndex = fields.findIndex((item) => item.id === over.id)
    if (oldIndex !== -1 && newIndex !== -1) {
      move(oldIndex, newIndex)
    }
  }

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
  )
}

type OptionItem = NonNullable<CheckoutInput["options"]>[number]

type OptionCardProps = {
  id: string
  option: OptionItem
  index: number
  control: any
  update: (index: number, value: any) => void
  remove: (index: number) => void
}

function OptionCard({ id, option, index, control, update, remove }: OptionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const typeIcon = optionIcons[option.type]

  const handleTypeChange = (nextType: OptionType) => {
    update(index, getDefaultOption(nextType))
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  }

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
  )
}

export default function CheckoutForm() {
  const market = useDashboardAuthorization().market
  if (!market) throw new Error("El negocio no tiene configuración regional.")
  const [loading, setLoading] = useState(false)
  const [loadingDatabaseData, setLoadingDatabaseData] = useState(true);
  const [paymentMethodCount, setPaymentMethodCount] = useState(0);
  const activeLocationId = useActiveLocationId();
  const loyaltyProgramConfigRef = React.useRef<LoyaltyProgramConfigFormHandle | null>(null);
  const [loyaltyDirty, setLoyaltyDirty] = useState(false);
  const [databaseCheckoutData, setDatabaseCheckoutData] = useState<CheckoutInput>({
    enable_discounts: false,
    redirect_to_whatsapp: false,
    customer_sends_whatsapp_manually: false,
    customer_sends_whatsapp_manually_location_ids: [],
    enable_electronic_invoice: false,
    show_loyalty_program_in_whatsapp: false,
    options: [],
  })

  useEffect(() => {
    async function getDatabaseCheckoutData() {
      if (!activeLocationId) return;
      setLoadingDatabaseData(true);
      const result = await getCheckoutCardsData(activeLocationId);

      if (!result.success) {
        toast.error(result.message)
        setLoadingDatabaseData(false);
        return;
      }
      const data = result.data;
      setPaymentMethodCount(result.paymentMethodCount);

      const normalizedData: CheckoutInput = {
        enable_discounts: data?.enable_discounts ?? false,
        redirect_to_whatsapp: data?.redirect_to_whatsapp ?? false,
        customer_sends_whatsapp_manually:
          result.paymentMethodCount === 0
            ? (data?.customer_sends_whatsapp_manually_location_ids ?? []).includes(activeLocationId)
            : false,
        customer_sends_whatsapp_manually_location_ids:
          data?.customer_sends_whatsapp_manually_location_ids ?? [],
        enable_electronic_invoice: data?.enable_electronic_invoice ?? false,
        show_loyalty_program_in_whatsapp: data?.show_loyalty_program_in_whatsapp ?? false,
        options: data?.options ?? [],
      };
      setDatabaseCheckoutData(normalizedData);
      setLoadingDatabaseData(false);
    }
    getDatabaseCheckoutData();
  }, [activeLocationId])

  const form = useForm<CheckoutInput>({
    resolver: zodResolver(CheckoutSchema),
    defaultValues: {
      enable_discounts: false,
      redirect_to_whatsapp: false,
      customer_sends_whatsapp_manually: false,
      customer_sends_whatsapp_manually_location_ids: [],
      enable_electronic_invoice: false,
      show_loyalty_program_in_whatsapp: false,
      options: [],
    },
  })
  
  useEffect(() => {
    if (databaseCheckoutData) {
      form.reset({
      ...databaseCheckoutData,
        enable_discounts: databaseCheckoutData.enable_discounts ?? false,
        redirect_to_whatsapp: databaseCheckoutData.redirect_to_whatsapp ?? false,
        customer_sends_whatsapp_manually:
          paymentMethodCount === 0
            ? databaseCheckoutData.customer_sends_whatsapp_manually ?? false
            : false,
        enable_electronic_invoice: databaseCheckoutData.enable_electronic_invoice ?? false,
        show_loyalty_program_in_whatsapp: databaseCheckoutData.show_loyalty_program_in_whatsapp ?? false,
      })
    }
  }, [databaseCheckoutData, form, paymentMethodCount])

  const { fields, append, prepend, update, remove, move } = useFieldArray({
    control: form.control,
    name: "options",
  })

  const addOption = (type: OptionType) => {
    prepend(getDefaultOption(type))
  }

  async function onSubmit(data: CheckoutInput) {
    setLoading(true);
    const parsed = CheckoutSchema.safeParse({
      ...data,
      enable_discounts: data.enable_discounts ?? false,
      redirect_to_whatsapp: data.redirect_to_whatsapp ?? false,
      customer_sends_whatsapp_manually:
        paymentMethodCount === 0
          ? data.customer_sends_whatsapp_manually ?? false
          : false,
      enable_electronic_invoice: data.enable_electronic_invoice ?? false,
      show_loyalty_program_in_whatsapp: data.show_loyalty_program_in_whatsapp ?? false,
    });
    if (parsed.error) {
      toast.error(`Error al procesar los datos: ${parsed.error}`);
      setLoading(false);
      return;
    }

    if (!activeLocationId) {
      toast.error("Selecciona una ubicación antes de guardar.");
      setLoading(false);
      return;
    }

    const result = await upsertCheckoutData({
      checkoutData: parsed.data,
      businessLocationId: activeLocationId,
    });

    if (!result.success) {
      toast.error(`Error al procesar los datos: ${result.message}`);
      setLoading(false);
      return;
    }

    if (parsed.data.show_loyalty_program_in_whatsapp) {
      const loyaltyResult = await loyaltyProgramConfigRef.current?.save();
      if (loyaltyResult && !loyaltyResult.success) {
        toast.error(loyaltyResult.message);
        setLoading(false);
        return;
      }
    }

    toast.success('Datos actualizados!')
    form.reset(parsed.data)
    setLoading(false);
  }

  const handleCardDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = fields.findIndex((item) => item.id === active.id)
    const newIndex = fields.findIndex((item) => item.id === over.id)
    if (oldIndex !== -1 && newIndex !== -1) {
      move(oldIndex, newIndex)
    }
  }
  const watchedOptions = (
    useWatch({
      control: form.control,
      name: "options" as const,
    }) ?? []
  ) as OptionItem[]
  const showLoyaltyProgramInWhatsapp = useWatch({
    control: form.control,
    name: "show_loyalty_program_in_whatsapp" as const,
  }) ?? false

  useEffect(() => {
    if (!showLoyaltyProgramInWhatsapp) setLoyaltyDirty(false)
  }, [showLoyaltyProgramInWhatsapp])

  if (loadingDatabaseData) {
    return (
      <p className="m-4 text-sm flex flex-row items-center justify-center space-x-4">
        <Loader2Icon className="animate-spin"/> <span>Cargando información del negocio</span>
      </p>
    )
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mb-20">
      <UnsavedChangesBar dirty={form.formState.isDirty || loyaltyDirty} saving={loading} onDiscard={() => {
        form.reset();
        loyaltyProgramConfigRef.current?.discard();
      }} />
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
                  {React.createElement(optionIcons[type], { className: "size-4" })}
                  <span>{optionLabels[type]}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Card className="w-full rounded-3xl">
        <CardContent className="space-y-4">
          <div className="text-md font-semibold">Opciones de checkout</div>

          <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
            <div className="flex flex-col">
              <span className="font-medium">Habilitar descuentos</span>
              <span className="text-muted-foreground">Permitir códigos de descuento en el checkout</span>
            </div>
            <Controller
              name="enable_discounts"
              control={form.control}
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
            <div className="flex flex-col pr-4">
              <span className="font-medium">Hacer que clientes envíen el pedido por WhatsApp</span>
              <span className="text-muted-foreground">
                {paymentMethodCount > 0
                  ? "No está disponible porque esta ubicación tiene métodos de pago habilitados."
                  : "No envía mensajes automáticos de Twilio. Al finalizar, el cliente deberá presionar Enviar WhatsApp para compartir el pedido con el negocio."}
              </span>
            </div>
            <Controller
              name="customer_sends_whatsapp_manually"
              control={form.control}
              render={({ field }) => (
                <Switch
                  checked={field.value ?? false}
                  disabled={paymentMethodCount > 0}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
            <div className="flex flex-col">
              <span className="font-medium">Mostrar teléfono del negocio en WhatsApp</span>
              <span className="text-muted-foreground">Incluir el número del negocio en el mensaje automático</span>
            </div>
            <Controller
              name="redirect_to_whatsapp"
              control={form.control}
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          {hasMarketCapability(market, "invoicing.electronic") ? <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
            <div className="flex flex-col">
              <span className="font-medium">Factura electrónica</span>
              <span className="text-muted-foreground">Solicitar al cliente los datos requeridos para facturación electrónica</span>
            </div>
            <Controller
              name="enable_electronic_invoice"
              control={form.control}
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div> : null}

          <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
            <div className="flex flex-col">
              <span className="font-medium">Programa de lealtad</span>
              <span className="text-muted-foreground">Mostrar enlace de tarjeta en el mensaje de WhatsApp</span>
            </div>
            <Controller
              name="show_loyalty_program_in_whatsapp"
              control={form.control}
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>
        </CardContent>
      </Card>

      {showLoyaltyProgramInWhatsapp && (
        <LoyaltyProgramConfigForm
          ref={loyaltyProgramConfigRef}
          enabled={showLoyaltyProgramInWhatsapp}
          onDirtyChange={setLoyaltyDirty}
        />
      )}

      <DndContext collisionDetection={closestCenter} onDragEnd={handleCardDragEnd}>
        <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {fields.map((field, index) => {
              const option = watchedOptions[index] as OptionItem | undefined
              if (!option) return null

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
              )
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
  )
}
