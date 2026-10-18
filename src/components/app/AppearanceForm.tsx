"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, Controller } from "react-hook-form"
import { toast } from "sonner"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { StoreAppearanceSchema, StoreAppearanceInput } from "@/lib/FormSchemas/StoreAppearanceSchema"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import FileUpload from "../file-upload"
import { useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"
import { getAppearanceData, upsertAppearanceData } from "@/app/admin/app/actions"
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider"
import { UnsavedChangesBar } from "@/components/forms/UnsavedChangesBar"

export default function AppearanceForm() {
  const [loading, setLoading] = useState(false);
  const [discardRevision, setDiscardRevision] = useState(0);
  const [loadingDatabaseData, setLoadingDatabaseData] = useState(true);
  const [databaseAppearanceData, setDatabaseAppearanceData] = useState<StoreAppearanceInput>({
    logo: "",
    front_page_image: "",
    name: "",
    description: "",
    primary_color: "#ff7c1d",
    background_color: "#ff7c1d",
    banner: {
      text: "",
      link: "",
    },
  })

  useEffect(() => {
    async function getDatabaseAppearanceData() {
      setLoadingDatabaseData(true);
      const result = await getAppearanceData();
      if (!result.success) {
        toast.error(`Error al obtener los datos de la tienda: ${result.message}`)
        setLoadingDatabaseData(false);
        return;
      }
      if (result.data != null) setDatabaseAppearanceData(result.data as StoreAppearanceInput);
      setLoadingDatabaseData(false);
    }
    getDatabaseAppearanceData();
  }, [])

  const form = useForm<StoreAppearanceInput>({
    resolver: zodResolver(StoreAppearanceSchema),
    defaultValues: {
      logo: "",
      front_page_image: "",
      name: "",
      description: "",
      primary_color: "#ff7c1d",
      background_color: "#ff7c1d",
      banner: {
        text: "",
        link: "",
      },
    },
  })

  useEffect(() => {
    if (databaseAppearanceData) {
      form.reset(databaseAppearanceData)
    }
  }, [databaseAppearanceData, form])

  const descripcion = form.watch("description") ?? ""

  async function onSubmit(data: StoreAppearanceInput) {
    setLoading(true);
    const parsed = StoreAppearanceSchema.safeParse(data);
    if (parsed.error) {
      toast.error(`Error al procesar los datos: ${parsed.error}`);
      setLoading(false);
      return;
    }
    const result = await upsertAppearanceData({ appearanceData: parsed.data });

    if (!result.success) {
      toast.error(`Error al procesar los datos: ${result.message}`);
      setLoading(false);
      return;
    }
    toast.success('Datos actualizados!')
    form.reset(parsed.data)
    setLoading(false);
  }

  const logoUrl = form.watch("logo")
  const portadaUrl = form.watch("front_page_image")
  const userId = useDashboardAuthorization().activeBusinessId;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="space-y-4 w-full mb-10"
    >
      <UnsavedChangesBar dirty={form.formState.isDirty} saving={loading} onDiscard={() => {
        form.reset();
        setDiscardRevision((value) => value + 1);
      }} />
      <Card className="w-full rounded-xl">
        <CardContent className="space-y-2">
          <h2 className="text-md font-semibold">Información de la farmacia</h2>
          <FieldGroup className="">
            <div className="space-y-2">
              <FieldLabel>Logo</FieldLabel>
              <FileUpload
                key={`logo-${discardRevision}`}
                bucketName="app_metadata"
                pathPrefix={`${userId}/logo`}
                multiple={false}
                maxSize={10 * 1024 * 1024}
                allowedTypes={["image/*"]}
                existingFiles={logoUrl ? [logoUrl] : []}
                onExistingFileRemove={() => {
                  form.setValue("logo", "", { shouldDirty: true, shouldValidate: true })
                }}
                onUploadComplete={(_, result) => {
                  form.setValue("logo", result.publicUrl, { shouldDirty: true, shouldValidate: true })
                }}
                onUploadError={(_, error) => {
                  toast.error(`Error al subir imagen: ${error}`)
                }}
                onFilesChange={(files) => {
                  const url = files.find((f) => f.status === "success" && f.publicUrl)?.publicUrl
                  if (url) {
                    form.setValue("logo", url, { shouldDirty: true, shouldValidate: true })
                  }
                }}
                showPreview
                autoUpload
                className="w-full"
              />
              {form.formState.errors.logo && (
                <p className="text-sm text-destructive">{form.formState.errors.logo.message as string}</p>
              )}
            </div>

            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Nombre</FieldLabel>
                  <Input
                    {...field}
                    aria-invalid={fieldState.invalid}
                    placeholder="Nombre de la tienda"
                    autoComplete="off"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="description"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>
                    Descripción
                  </FieldLabel>
                  <FieldDescription className="text-xs">
                    Decora con <strong>**negrita**</strong>, ~<s>tachado</s>~, <em>_cursiva_</em>
                  </FieldDescription>
                  <Textarea
                    {...field}
                    aria-invalid={fieldState.invalid}
                    placeholder="Descripción breve"
                    rows={4}
                    className="resize-none"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            {descripcion && (
              <div className="border rounded-md p-3 bg-muted/40">
                <p className="text-sm text-muted-foreground mb-2 font-medium">
                  Vista previa:
                </p>
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {descripcion}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="w-full rounded-xl">
        <CardContent className="space-y-4">
          <h2 className="text-md font-semibold">Colores</h2>
          <FieldGroup className="space-y-4">
            <Controller
              name="primary_color"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Color primario</FieldLabel>
                  <FieldDescription className="text-xs">
                    Este color se usará en botones y resaltados para mantener consistencia.
                  </FieldDescription>
                  <div className="flex items-center gap-2">
                    <Input
                      type="color"
                      aria-label="Selector de color primario"
                      className="w-7 h-7 rounded-full p-0 border border-input bg-transparent
                        [appearance:none]
                        [&::-webkit-color-swatch-wrapper]:p-0
                        [&::-webkit-color-swatch]:border-none
                        [&::-webkit-color-swatch]:rounded-full
                        [&::-moz-color-swatch]:border-none
                        [&::-moz-color-swatch]:rounded-full"
                      value={field.value}
                      onChange={field.onChange}
                    />
                    <Input
                      {...field}
                      type="text"
                      aria-invalid={fieldState.invalid}
                      className="flex-1"
                    />
                  </div>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="background_color"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Color de fondo</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      type="color"
                      aria-label="Selector de color de fondo"
                      className="w-7 h-7 rounded-full p-0 border border-input bg-transparent
                        [appearance:none]
                        [&::-webkit-color-swatch-wrapper]:p-0
                        [&::-webkit-color-swatch]:border-none
                        [&::-webkit-color-swatch]:rounded-full
                        [&::-moz-color-swatch]:border-none
                        [&::-moz-color-swatch]:rounded-full"
                      value={field.value}
                      onChange={field.onChange}
                    />
                    <Input
                      {...field}
                      type="text"
                      aria-invalid={fieldState.invalid}
                      className="flex-1"
                    />
                  </div>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <div className="space-y-2">
              <FieldLabel>Imagen de portada</FieldLabel>
              <FieldDescription className="text-xs">Relación recomendada 1:1. Tamaño máximo 2MB.</FieldDescription>
              <FileUpload
                key={`cover-${discardRevision}`}
                bucketName="app_metadata"
                pathPrefix={`${userId}/logo`}
                multiple={false}
                maxSize={10 * 1024 * 1024}
                allowedTypes={["image/*"]}
                existingFiles={portadaUrl ? [portadaUrl] : []}
                onExistingFileRemove={() => {
                  form.setValue("front_page_image", "", { shouldDirty: true, shouldValidate: true })
                }}
                onUploadComplete={(_, result) => {
                  form.setValue("front_page_image", result.publicUrl, { shouldDirty: true, shouldValidate: true })
                }}
                onUploadError={(_, error) => {
                  toast.error(`Error al subir imagen: ${error}`)
                }}
                onFilesChange={(files) => {
                  const url = files.find((f) => f.status === "success" && f.publicUrl)?.publicUrl
                  if (url) {
                    form.setValue("front_page_image", url, { shouldDirty: true, shouldValidate: true })
                  }
                }}
                showPreview
                autoUpload
                className="w-full"
              />
              {form.formState.errors.front_page_image && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.front_page_image.message as string}
                </p>
              )}
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="w-full rounded-xl">
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-lg font-semibold">Banner</h2>
          <FieldGroup className="space-y-3">
            <Controller
              name="banner.text"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Texto</FieldLabel>
                  <Input
                    {...field}
                    aria-invalid={fieldState.invalid}
                    placeholder="Noticia o descuento"
                    autoComplete="off"
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="banner.link"
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
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
      </Card>

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
  )
}
