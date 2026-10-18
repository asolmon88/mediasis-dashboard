"use client"

import * as React from "react"
import { StartCardsInput, StartCardsSchema } from "@/lib/FormSchemas/startCardsSchema"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  Loader2Icon,
  Plus,
  Trash2,
  Type as TypeIcon,
  Video as VideoIcon,
} from "lucide-react"
import FileUpload from "../file-upload"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  useCurrentBusinessCategories
} from "@/hooks/use-current-business-categories"
import { SelectOption } from "@/lib/types/dashboardTypes"
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useEffect, useState } from "react"
import { getStartCardsData, upsertStartCardsData } from "@/app/admin/app/actions"
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider"
import { UnsavedChangesBar } from "@/components/forms/UnsavedChangesBar"

type FormInstance = ReturnType<typeof useForm<{ cards: StartCardsInput }>>

type SortableCardProps = {
  card: { id: string } & StartCardsInput[number]
  index: number
  form: FormInstance
  categoryOptions: SelectOption[]
  categoriesLoading: boolean
  update: (index: number, value: any) => void
  remove: (index: number) => void
}

function SortableCard({
  card,
  index,
  form,
  categoryOptions,
  categoriesLoading,
  update,
  remove,
}: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  }

  const icon =
    card.type === "text"
      ? TypeIcon
      : card.type === "image"
        ? ImageIcon
        : card.type === "link"
          ? Link2
          : card.type === "video"
            ? VideoIcon
            : LayoutGrid

  const label =
    card.type === "text"
      ? "Texto"
      : card.type === "image"
        ? "Imagen"
        : card.type === "link"
          ? "Link"
      : card.type === "video"
        ? "Video"
        : "Categoría de Producto"

  const visible =
    (form.watch(`cards.${index}.visible`) as boolean | undefined) !==
    false

  const descriptionValue = form.watch(`cards.${index}.text`) || ""
  const userId = useDashboardAuthorization().activeBusinessId;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="w-full rounded-xl"
    >
      <CardContent className="">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-6 place-items-center rounded-sm bg-muted">
              {React.createElement(icon, { className: "size-3" })}
            </div>
            <div className="font-medium text-sm">{label}</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label="Drag"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </Button>
        </div>

        <div className="mt-2">
          <FieldGroup>
            {card.type === "text" && (
              <>
                <Controller
                  name={`cards.${index}.title`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <Input
                        {...field}
                        aria-invalid={fieldState.invalid}
                        placeholder="Título"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
                <Controller
                  name={`cards.${index}.text`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel className="text-muted-foreground">
                        Decora con <strong>**negrita**</strong>, ~<s>tachado</s>~,{" "}<em>_italic_</em>
                      </FieldLabel>
                      <Textarea
                        {...field}
                        aria-invalid={fieldState.invalid}
                        placeholder="Texto libre"
                        rows={5}
                        className="resize-none"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
                {/* Markdown Preview */}
                {descriptionValue && (
                  <div className="border rounded-md p-3 bg-muted/40">
                    <p className="text-sm text-muted-foreground mb-2 font-medium">
                      Vista previa:
                    </p>
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {descriptionValue}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </>
            )}

            {card.type === "image" && (
              <>
                <Controller
                  name={`cards.${index}.title`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <Input
                        {...field}
                        aria-invalid={fieldState.invalid}
                        placeholder="Título"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <FileUpload
                  bucketName="app_metadata"
                  pathPrefix={userId ? `${userId}/start-cards` : ''}
                  multiple={true}
                  maxSize={10 * 1024 * 1024}
                  allowedTypes={["image/*"]}
                  existingFiles={
                    (form.watch(`cards.${index}.links_to_image`) as string[] | undefined) ?? []
                  }
                  onExistingFileRemove={(url) => {
                    const currentImages =
                      (form.getValues(`cards.${index}.links_to_image`) as string[] | undefined) ?? []
                    const updatedImages = currentImages.filter((img) => img !== url)
                    form.setValue(`cards.${index}.links_to_image`, updatedImages, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }}
                  onUploadComplete={(fileData, result) => {
                    const currentImages =
                      (form.getValues(`cards.${index}.links_to_image`) as string[] | undefined) ?? []
                    form.setValue(`cards.${index}.links_to_image`, [...currentImages, result.publicUrl], {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }}
                  onUploadError={(fileData, error) => {
                    toast.error(`Error al subir imagen: ${error}`)
                  }}
                  onFilesChange={(files) => {
                    const uploadedUrls = files
                      .filter((f) => f.status === "success" && f.publicUrl)
                      .map((f) => f.publicUrl)
                      .filter((url): url is string => url !== null)

                    const currentImages =
                      (form.getValues(`cards.${index}.links_to_image`) as string[] | undefined) ?? []
                    const unique = Array.from(new Set([...currentImages, ...uploadedUrls]))

                    form.setValue(`cards.${index}.links_to_image`, unique, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }}
                  showPreview={true}
                  autoUpload={true}
                  className="w-full"
                />

                <Controller
                  name={`cards.${index}.redirect_link`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Link (opcional)</FieldLabel>
                      <Input
                        {...field}
                        aria-invalid={fieldState.invalid}
                        placeholder="https://..."
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              </>
            )}

            {card.type === "link" && (
              <>
                <Controller
                  name={`cards.${index}.title`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <Input
                        {...field}
                        aria-invalid={fieldState.invalid}
                        placeholder="Título"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  name={`cards.${index}.link_to_link`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Link</FieldLabel>
                      <Input
                        {...field}
                        aria-invalid={fieldState.invalid}
                        placeholder="https://..."
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              </>
            )}

            {card.type === "video" && (
              <>
                <Controller
                  name={`cards.${index}.title`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <Input
                        {...field}
                        aria-invalid={fieldState.invalid}
                        placeholder="Título"
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  name={`cards.${index}.link_to_video`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Video link</FieldLabel>
                      <Input
                        {...field}
                        aria-invalid={fieldState.invalid}
                        placeholder="https://..."
                        autoComplete="off"
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              </>
            )}

            {card.type === "product_category" && (
              <>
                <Controller
                  name={`cards.${index}.category.value`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <Select
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value)
                          const selected = categoryOptions.find((option) => option.value === value)
                          form.setValue(
                            `cards.${index}.category.label`,
                            selected?.label ?? "",
                            { shouldValidate: true, shouldDirty: true }
                          )
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona una categoría" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoryOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                          {categoriesLoading && (
                            <div className="px-2 py-1 text-sm text-muted-foreground">
                              Cargando categorías...
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />

                <Controller
                  name={`cards.${index}.feature_only_four_products`}
                  control={form.control}
                  render={({ field }) => (
                    <Field orientation="horizontal" className="pt-2">
                      <FieldLabel>Mostrar sólo 4 productos</FieldLabel>
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={field.onChange}
                      />
                    </Field>
                  )}
                />
              </>
            )}
          </FieldGroup>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              const current = form.getValues(`cards.${index}`) as any
              if (typeof current?.visible !== "boolean") return
              update(index, { ...current, visible: !current.visible })
            }}
            className={cn(
              "text-muted-foreground",
              visible === false && "opacity-70"
            )}
            aria-label={visible ? "Hide card" : "Show card"}
          >
            {visible ? (
              <Eye className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => remove(index)}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Delete card"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function StartCardsForm() {
  const [loading, setLoading] = useState(false);
  const [loadingDatabaseData, setLoadingDatabaseData] = useState(true);
  const [databaseStartCardsData, setDatabaseStartCardsData] = useState<StartCardsInput>([
    {
      type: "text",
      title: "",
      text: "",
      visible: true,
    },
  ])

  useEffect(() => {
    async function getDatabaseStartCardsData() {
      setLoadingDatabaseData(true);
      const result = await getStartCardsData();
      if (!result.success) {
        toast.error(`Error al obtener los datos de la tienda: ${result.message}`)
        setLoadingDatabaseData(false);
        return;
      }
      if (result.data) setDatabaseStartCardsData(result.data as StartCardsInput);
      setLoadingDatabaseData(false);
    }
    getDatabaseStartCardsData();
  }, [])
  

  const formSchema = React.useMemo(
    () =>
      z.object({
        cards: StartCardsSchema,
      }),
    []
  )

  const form = useForm<{ cards: StartCardsInput }>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      cards: databaseStartCardsData
    },
  })

  useEffect(() => {
    if (databaseStartCardsData && databaseStartCardsData.length > 0) {
      form.reset({ cards: databaseStartCardsData })
    }
  }, [databaseStartCardsData, form])

  const { fields, append, prepend, remove, update, move } = useFieldArray({
    control: form.control,
    name: "cards",
  })

  const [categoryOptions, setCategoryOptions] = React.useState<SelectOption[]>([])
  const [categoriesLoading, setCategoriesLoading] = React.useState(false)

  useCurrentBusinessCategories({ setCategoryOptions, setCategoriesLoading })

  async function onSubmit(data: StartCardsInput) {
    setLoading(true);
    const parsed = StartCardsSchema.safeParse(data);
    if (parsed.error) {
      toast.error(`Error al procesar los datos: ${parsed.error}`);
      setLoading(false);
      return;
    }
    const result = await upsertStartCardsData({ startCardsData: parsed.data });

    if (!result.success) {
      toast.error(`Error al procesar los datos: ${result.message}`);
      setLoading(false);
      return;
    }
    toast.success('Datos actualizados!')
    form.reset({ cards: parsed.data })
    setLoading(false);
  }

  function addCard(type: StartCardsInput[number]["type"]) {
    if (type === "text") {
      prepend({ type: "text", title:"", text: "", visible: true })
      return
    }
    if (type === "image") {
      prepend({ type: "image", links_to_image: [], title: "", visible: true })
      return
    }
    if (type === "link") {
      prepend({ type: "link", title: "", link_to_link: "", visible: true })
      return
    }
    if (type === "video") {
      prepend({ type: "video", title: "", link_to_video: "", visible: true })
      return
    }
    prepend({
      type: "product_category",
      category: { label: "", value: "" },
      feature_only_four_products: false,
      visible: true,
    })
  }

  const cards = form.watch("cards") ?? []

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = fields.findIndex((f) => f.id === active.id)
    const newIndex = fields.findIndex((f) => f.id === over.id)
    if (oldIndex !== -1 && newIndex !== -1) {
      move(oldIndex, newIndex)
    }
  }

  if (loadingDatabaseData) {
    return (
      <p className="m-4 text-sm flex flex-row items-center justify-center space-x-4">
        <Loader2Icon className="animate-spin"/> <span>Cargando información del negocio</span>
      </p>
    )
  }

  return (
    <div className="w-full mb-20">
      <div className="mb-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" className="w-full text-sm">
              <Plus className="mr-2 size-3" />
              Agregar tarjeta
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-56">
            <DropdownMenuItem onSelect={() => addCard("product_category")}>
              <LayoutGrid className="mr-2 size-4" />
              Categoría de producto
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addCard("text")}>
              <TypeIcon className="mr-2 size-4" />
              Texto
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addCard("image")}>
              <ImageIcon className="mr-2 size-4" />
              Imagen
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addCard("link")}>
              <Link2 className="mr-2 size-4" />
              Link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => addCard("video")}>
              <VideoIcon className="mr-2 size-4" />
              Video
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <form
        onSubmit={form.handleSubmit((values) => onSubmit(values.cards))}
        className="space-y-4"
      >
        <UnsavedChangesBar dirty={form.formState.isDirty} saving={loading} onDiscard={() => form.reset()} />
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            {fields.map((card, index) => (
              <SortableCard
                key={card.id}
                card={card as any}
                index={index}
                form={form}
                categoryOptions={categoryOptions}
                categoriesLoading={categoriesLoading}
                update={update}
                remove={remove}
              />
            ))}
          </SortableContext>
        </DndContext>
        <div className="flex w-full justify-start">
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
    </div>
  )
}
