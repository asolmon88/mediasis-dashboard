'use client'; 

import {
  ProductEditInput,
  ProductEditSchema,
} from "@/lib/FormSchemas/productEditSchema";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  useFieldArray,
  useForm,
} from "react-hook-form";
import { OptionCard } from "./OptionFields";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { UnsavedChangesBar } from "@/components/forms/UnsavedChangesBar";
import { MarketCurrencyCode } from "@/components/dashboard/MarketCurrencyCode";
import { DecimalMoneyInput } from "@/components/dashboard/DecimalMoneyInput";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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
  MultiSelectorCreateItem,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
  MultiSelectValue,
} from "@/components/ui/multi-select";
import { Input } from "../ui/input";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Label } from "../ui/label";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  Loader2Icon,
} from "lucide-react";
import { Textarea } from "../ui/textarea";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSupabaseUpload } from "@/hooks/use-supabase-upload";
import { AddButton } from "../add-button";
import { updateProduct } from "@/app/admin/products/[product_id]/actions";
import { createProductCategoryOption, getProductCategoryOptions } from "@/app/admin/products/actions";
import FileUpload from "../file-upload";
import { ReorderDialog } from "./ReorderDialog";
import { toast } from "sonner";
import { SelectOption } from "@/lib/types/dashboardTypes";
import { useCurrentBusinessDeliveryMethods } from "@/hooks/use-current-business-delivery-methods";
import VariantLocation from "./product-form/VariantLocation";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";


// TODO
const BASE_PATH = "7e15147b-89b0-4abe-8a29-5bf7a9acb525"; // for now, padfy, change to the current business UUID

type ProductWithLegacyCategory = ProductEditInput & {
  product_id?: string;
  category?: ProductEditInput["categories"];
  available_everywhere?: boolean;
};

type EditProductFormProps = {
  product?: ProductWithLegacyCategory;
  productId: string;
};

function removeNulls<T>(value: T): T {
  if (value === null) {
    return undefined as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => removeNulls(item)) as T;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, val]) => [key, removeNulls(val)],
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}

export default function EditProductForm({ product, productId }: EditProductFormProps) {
  const router = useRouter();
  const [showMoreVariants, setShowMoreVariants] = useState(false);
  const [loading, setLoading] = useState(false);
  const [discardRevision, setDiscardRevision] = useState(0);
  const authorization = useDashboardAuthorization();
  const businessLocations = authorization.locations;
  const canManageAllLocations = authorization.mode === "legacy" || authorization.allLocations;
  const [initialImages, setInitialImages] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<MultiSelectValue[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [deliveryMethodOptions, setDeliveryMethodOptions] = useState<SelectOption[]>([]);
  const [deliveryMethodsLoading, setDeliveryMethodsLoading] = useState(false);
  const [availableEverywhere, setAvailableEverywhere] = useState(true);

  const fixedProduct = product ? removeNulls(structuredClone(product)) : undefined;

  if (fixedProduct) {
    const normalizedCategories =
      (fixedProduct.categories && fixedProduct.categories.length > 0
        ? fixedProduct.categories
        : fixedProduct.category) ?? [];
    fixedProduct.categories = normalizedCategories;
    fixedProduct.weight = Number(fixedProduct.weight ?? "");
    fixedProduct.variants?.forEach(v => {
      v.weight = Number(v.weight ?? "");
    });
  }

  const form = useForm<ProductEditInput>({
    resolver: zodResolver(ProductEditSchema),
    defaultValues: {
      ...fixedProduct
    },
  });

  useEffect(() => {
    if (!canManageAllLocations) setAvailableEverywhere(false);
  }, [canManageAllLocations]);

  const {
    fields: variants,
    append: variantsAppend,
    remove: variantsRemove,
    replace: variantsReplace
  } = useFieldArray({
    control: form.control,
    name: "variants",
  });

  const {
    fields: options,
    append: optionsAppend,
    remove: optionsRemove,
    replace: optionsReplace
  } = useFieldArray({
    control: form.control,
    name: "options",
  });

  const {
    fields: attachedGroupSequences,
    replace: attachedGroupSequencesReplace,
  } = useFieldArray({
    control: form.control,
    name: "attached_group_sequences",
  });

  const images = form.watch("images") || [];
  const initialVariantImages = useMemo(
    () => product?.variants?.map((variant) => variant.images ?? []) ?? [],
    [product?.variants],
  );

  // Calculate which files are existing vs newly uploaded
  const existingFiles = images.filter((url) => initialImages.includes(url));

  const descriptionValue = form.watch("description") || "";
  const descriptionLines = descriptionValue.replace(/\r\n/g, "\n").split("\n");

  // unified sequence dialog
  const optionValues = form.watch("options") ?? [];
  const attachedGroupValues = form.watch("attached_group_sequences") ?? [];

  type SeqItem = { id: string; label: string; type: "option" | "group"; sequence: number };
  const unifiedSeqItems: SeqItem[] = [
    ...options.map((f, i) => ({
      id: f.id,
      label: optionValues[i]?.name?.trim() || `Opción ${i + 1}`,
      type: "option" as const,
      sequence: optionValues[i]?.sequence ?? i + 1,
    })),
    ...attachedGroupSequences.map((f, i) => ({
      id: f.id,
      label: attachedGroupValues[i]?.name?.trim() || `Grupo ${i + 1}`,
      type: "group" as const,
      sequence: attachedGroupValues[i]?.sequence ?? i + 1,
    })),
  ].sort((a, b) => a.sequence - b.sequence);

  // variants reorderdialog
  const variantsValues = form.watch("variants") ?? [];
  const dialogVariantsItems = variants.map((field, index) => ({
    id: field.id,
    name: variantsValues[index]?.name ?? "",
    sequence: variantsValues[index]?.sequence ?? index + 1,
  }));

  const uploadMainImageProps = useSupabaseUpload({
    bucketName: "products",
    path: BASE_PATH, // for now, padfy, change to the current business UUID
    allowedMimeTypes: ["image/*"],
    maxFiles: 5,
    maxFileSize: 2 * 1024 * 1024, // 2MB
    upsert: true,
  });

  const uploadedImageKeys: string[] = useMemo(() => {
    const files = uploadMainImageProps.files ?? [];
    return files
      .map((f) => (f.name ? `${BASE_PATH}/${f.name}` : ""))
      .filter(Boolean);
  }, [uploadMainImageProps.files]);

  const businessId = authorization.activeBusinessId ?? "products";
  useCurrentBusinessDeliveryMethods({
    setDeliveryMethodOptions,
    setDeliveryMethodsLoading,
  });
  useEffect(() => {
    const productImages = product?.images ?? [];
    setInitialImages((prev) => {
      if (prev.length === productImages.length &&
        prev.every((img, idx) => img === productImages[idx])) {
        return prev;
      }
      return productImages;
    });
  }, [product?.images]);

  useEffect(() => {
    const current = form.getValues("business_locations") ?? [];
    setAvailableEverywhere(product?.available_everywhere ?? current.length === 0);
  }, [form, product?.available_everywhere]);

  useEffect(() => {
    let ignore = false;
    async function loadCategories() {
      setCategoriesLoading(true);
      try {
        const result = await getProductCategoryOptions();
        if (!result.success) throw new Error(result.message);
        const data = result.data;
        if (ignore) return;
        type CategoryRow = { product_category_id: string | null; name: string | null };
        const mapped =
          (data ?? [])
            .map((row: CategoryRow): MultiSelectValue | null => {
              const trimmed = row.name?.trim() ?? "";
              if (!row.product_category_id || !trimmed.length) {
                return null;
              }
              return {
                value: row.product_category_id,
                label: trimmed,
              };
            })
            .filter(
              (item: MultiSelectValue | null): item is MultiSelectValue =>
                Boolean(item),
            );
        setCategoryOptions(mapped);
      } catch (error) {
        if (!ignore) {
          console.error(error);
          toast.error("No se pudieron cargar las categorías");
        }
      } finally {
        if (!ignore) {
          setCategoriesLoading(false);
        }
      }
    }
    loadCategories();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    // Only set when the upload hook marks success or when files have been added/removed
    if (uploadMainImageProps.isSuccess && uploadedImageKeys.length >= 0) {
      form.setValue("images", uploadedImageKeys, {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
  }, [uploadMainImageProps.isSuccess, uploadedImageKeys, form]);

  const handleCategoryCreate = useCallback(
    async (
      rawName: string,
      currentValues: MultiSelectValue[],
      onChange: (values: MultiSelectValue[]) => void,
    ) => {
      const normalized = rawName.trim();
      if (!normalized) {
        return;
      }

      const existing = categoryOptions.find(
        (option) => option.label.toLowerCase() === normalized.toLowerCase(),
      );
      if (existing) {
        const alreadySelected = currentValues.some(
          (item) => item.value === existing.value,
        );
        if (!alreadySelected) {
          onChange([...currentValues, existing]);
        }
        return;
      }

      setCreatingCategory(true);
      try {
        const result = await createProductCategoryOption(normalized);
        if (!result.success) throw new Error(result.message);
        const data = result.data;
        if (!data?.product_category_id) {
          throw new Error("Respuesta inválida al crear la categoría");
        }

        const newOption: MultiSelectValue = {
          value: data.product_category_id,
          label: data.name?.trim() || normalized,
        };
        setCategoryOptions((prev) => [...prev, newOption]);
        onChange([...currentValues, newOption]);
        toast.success("Categoría creada");
      } catch (error) {
        console.error(error);
        toast.error("No se pudo crear la categoría");
      } finally {
        setCreatingCategory(false);
      }
    },
    [categoryOptions],
  );

  async function onSubmit(data: z.infer<ProductEditInput>) {
    setLoading(true);
    const parsed = ProductEditSchema.safeParse(data);
    if (!parsed.success) {
      toast.error(`Datos inválidos: ${parsed.error}`, );
      setLoading(false);
      return;
    }
    if (!productId) {
      toast.error("No se encontró el identificador del producto");
      setLoading(false);
      return;
    }
    const addResult = await updateProduct(productId, parsed.data);
    if (!addResult.success) {
      toast.error(`Error al guardar el producto: ${addResult.message}`);
      setLoading(false);
      return;
    }
    toast.success(`Producto guardado!`)
    setLoading(false);
    router.push("/admin/products");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit, () => {
      toast.error("Hay campos con errores. Por favor revísalos antes de continuar.");
    })}>
      <UnsavedChangesBar dirty={form.formState.isDirty || (canManageAllLocations && availableEverywhere !== (product?.available_everywhere ?? true))} saving={loading} onDiscard={() => {
        form.reset();
        setAvailableEverywhere(product?.available_everywhere ?? (fixedProduct?.business_locations?.length ?? 0) === 0);
        setDiscardRevision((value) => value + 1);
      }} />
      <div className="flex flex-col space-y-4">
        <Card>
          <CardContent>
            <FieldGroup className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Name */}
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel>Nombre *</FieldLabel>
                    <Input placeholder="Name" {...field} />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              {/* Visibility */}
              <Controller
                name="visibility"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel>Visibilidad *</FieldLabel>
                    <Select
                      value={field.value ? "visible" : "hidden"}
                      onValueChange={(val) => field.onChange(val === "visible")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Visibility" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="visible">Visible</SelectItem>
                        <SelectItem value="hidden">Oculto/a</SelectItem>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              {/* Type */}
              <Controller
                name="type"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel>Tipo *</FieldLabel>
                    <Select
                      {...field}
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="physical">Físico</SelectItem>
                        <SelectItem value="digital">Digital</SelectItem>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              {/* Category */}
              <Controller
                name="categories"
                control={form.control}
                render={({ field, fieldState }) => {
                  return (
                    <Field>
                      <FieldLabel>Categoría *</FieldLabel>
                      <MultiSelector
                        values={field.value || []}
                        onValuesChange={field.onChange}
                        loop
                        className="w-full"
                      >
                        <MultiSelectorTrigger>
                          <MultiSelectorInput placeholder="Busca o crea una categoría" />
                        </MultiSelectorTrigger>
                        <MultiSelectorContent>
                          <MultiSelectorList>
                            {categoryOptions.map((option) => (
                              <MultiSelectorItem
                                key={option.value}
                                value={option.value}
                                label={option.label}
                              >
                                {option.label}
                              </MultiSelectorItem>
                            ))}
                            {categoriesLoading && (
                              <div className="px-2 py-1 text-sm text-muted-foreground">
                                Cargando categorías...
                              </div>
                            )}
                            <MultiSelectorCreateItem
                              onCreate={(value) =>
                                handleCategoryCreate(
                                  value,
                                  field.value || [],
                                  field.onChange,
                                )
                              }
                              isLoading={creatingCategory}
                              disabled={creatingCategory}
                              description="Agregar al storefront"
                              formatLabel={(value) => `Crear "${value}"`}
                            />
                          </MultiSelectorList>
                        </MultiSelectorContent>
                      </MultiSelector>
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  );
                }}
              />

              {/* SKU */}
              <Controller
                name="sku"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel>SKU</FieldLabel>
                    <Input placeholder="SKU" {...field} />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              {/* Weight */}
              <Controller
                name="weight"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel>Peso</FieldLabel>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;

                          // Allow empty string so the user can delete
                          if (raw === "") {
                            field.onChange(0);
                            return;
                          }

                          const num = Number(raw);
                          if (!isNaN(num)) {
                            field.onChange(num);
                          }
                        }}
                        className="w-full"
                      />
                      <span className="text-sm text-muted-foreground">g</span>
                    </div>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            </FieldGroup>
          </CardContent>
        </Card>
        {/* PRICING */}
        <Card>
          <CardHeader>
            <CardTitle>Precios</CardTitle>
          </CardHeader>

          <CardContent>
            <FieldGroup className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Price */}
              <Controller
                name="price"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel>Precio *</FieldLabel>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <MarketCurrencyCode />
                      </span>
                      <DecimalMoneyInput
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        className="pl-7"
                      />
                    </div>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              {/* Original price */}
              <Controller
                name="original_price"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel>Precio original</FieldLabel>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <MarketCurrencyCode />
                      </span>
                      <DecimalMoneyInput
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        className="pl-7"
                      />
                    </div>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            </FieldGroup>

            {/* Show more section */}
            {/* {showMore && (
              <div className="mt-6 space-y-4"> */}
            {/* Estimated price toggle */}
            {/* <div className="flex items-center space-x-2">
                  <Controller
                    name="estimated_price"
                    control={control}
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        id="estimated_price"
                      />
                    )}
                  />
                  <Label htmlFor="estimated_price" className="text-sm">
                    Display as estimated price
                  </Label>
                </div> */}

            {/* Checkboxes */}
            {/* <div className="flex flex-col gap-2">
                  {[
                    { name: "cost_per_item", label: "Cost per item" },
                    { name: "price_per_unit", label: "Price per unit" },
                    { name: "tax_override", label: "Tax override" },
                  ].map((opt) => (
                    <div key={opt.name} className="flex items-center space-x-2">
                      <Controller
                        name={opt.name as string}
                        control={control}
                        render={({ field }) => (
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            id={opt.name}
                          />
                        )}
                      />
                      <Label htmlFor={opt.name} className="text-sm">
                        {opt.label}
                      </Label>
                    </div>
                  ))} */}
            {/* </div>
              </div>
            )} */}
          </CardContent>

          {/* Show more / less button */}
          {/* <CardFooter className="flex justify-center border-t">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowMore(!showMore)}
              className="text-sm flex items-center gap-1"
            >
              {showMore ? (
                <>
                  Show less <ChevronUp className="" />
                </>
              ) : (
                <>
                  Show more <ChevronDown className="" />
                </>
              )}
            </Button>
          </CardFooter> */}
        </Card>
        {/* DESCRIPTION */}
        <Card>
          <CardHeader>
            <CardTitle>Descripción</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            <Controller
              name="description"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field>
                  <p className="text-sm text-muted-foreground">
                    Decora con <strong>**negrita**</strong>, ~<s>tachado</s>~,{" "}
                    <em>_italic_</em>
                  </p>
                  <Textarea
                    {...field}
                    placeholder="Escribe una descripción detallada..."
                    className="min-h-[120px]"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* Markdown Preview */}
            {descriptionValue && (
              <div className="prose prose-sm max-w-none">
                {descriptionLines.map((line, index) => (
                  <Fragment key={index}>
                    {line ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <>{children}</>,
                        }}
                      >
                        {line}
                      </ReactMarkdown>
                    ) : null}
                    {index < descriptionLines.length - 1 && <br />}
                  </Fragment>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        {/* IMAGES */}
        <Card>
          <CardHeader>
            <CardTitle>Imágenes</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {/* <ImagePreviewList
              bucket="products"
              form={form}
              images={form.watch("images") || []}
            />
            <Controller
              name="images"
              control={form.control}
              render={({ field }) => (
                <div>
                  <Dropzone
                    {...uploadMainImageProps}
                  >
                    <DropzoneEmptyState />
                    <DropzoneContent />
                  </Dropzone>

                  <p className="text-xs text-muted-foreground mt-2">
                    File should not exceed 10 MB. Recommended ratio is 1 : 1.
                  </p>
                </div>
              )}
            /> */}
            <FileUpload
              key={`product-image-${discardRevision}`}
              bucketName="products"
              pathPrefix={businessId}
              multiple={true}
                    maxSize={10 * 1024 * 1024}
                    allowedTypes={["image/*"]}
                    existingFiles={existingFiles}
              onExistingFileRemove={(url) => {
                // Remove the existing file URL from form state
                const currentImages = form.getValues("images") || [];
                const updatedImages = currentImages.filter((img) => img !== url);
                form.setValue("images", updatedImages, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
              }}
              onUploadComplete={(fileData, result) => {
                // Add the new uploaded file URL to the form state
                const currentImages = form.getValues("images") || [];
                form.setValue("images", [...currentImages, result.publicUrl], {
                  shouldValidate: true,
                  shouldDirty: true,
                });
              }}
              onUploadError={(fileData, error) => {
                console.error("Upload error:", error);
              }}
              onFilesChange={(files) => {
                // Extract newly uploaded publicUrl entries
                const uploadedUrls = files
                  .filter((f) => f.status === "success" && f.publicUrl)
                  .map((f) => f.publicUrl)
                  .filter((url): url is string => url !== null);

                // Append to current form images and de-duplicate
                const currentImages = form.getValues("images") || [];
                const unique = Array.from(new Set([...currentImages, ...uploadedUrls]));

                form.setValue("images", unique, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
              }}
              showPreview={true}
              autoUpload={true}
              className="w-full"
            />
          </CardContent>
        </Card>

        {/* DELIVERY */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Delivery</CardTitle>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            <Label className="text-sm font-medium">Métodos disponibles</Label>

            <Controller
              name="delivery_methods"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field>
                  <MultiSelector
                    values={field.value || []}
                    onValuesChange={field.onChange}
                    loop
                    className="w-full"
                  >
                    <MultiSelectorTrigger>
                      <MultiSelectorInput
                        placeholder={
                          deliveryMethodsLoading
                            ? "Cargando métodos disponibles"
                            : "Select available methods"
                        }
                      />
                    </MultiSelectorTrigger>
                    <MultiSelectorContent>
                      <MultiSelectorList>
                        {deliveryMethodOptions.map((method) => (
                          <MultiSelectorItem
                            key={method.value}
                            value={method.value}
                            label={method.label}
                          >
                            {method.label}
                          </MultiSelectorItem>
                        ))}
                      </MultiSelectorList>
                    </MultiSelectorContent>
                  </MultiSelector>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </CardContent>
        </Card>

        {/* BUSINESS LOCATION */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Ubicaciones</CardTitle>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            <Label className="text-sm font-medium">Ubicaciones disponibles</Label>

            <Controller
              name="business_locations"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field>
                  {canManageAllLocations ? <div className="flex items-center space-x-3">
                    <Checkbox
                      id="product-edit-available-everywhere"
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
                      htmlFor="product-edit-available-everywhere"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Disponible en todas las ubicaciones
                    </label>
                  </div> : null}

                  {(!canManageAllLocations || !availableEverywhere) && (
                    <div className="mt-3">
                      <MultiSelector
                        values={field.value || []}
                        onValuesChange={(vals) => {
                          field.onChange(vals);
                          if (canManageAllLocations) setAvailableEverywhere(vals.length === 0);
                        }}
                        loop
                        className="w-full"
                      >
                        <MultiSelectorTrigger>
                          <MultiSelectorInput placeholder="Selecciona las ubicaciones disponibles" />
                        </MultiSelectorTrigger>
                        <MultiSelectorContent>
                          <MultiSelectorList>
                            {businessLocations.map((location)=>{
                              return (
                                <MultiSelectorItem
                                  key={location.business_location_id}
                                  value={location.business_location_id}
                                  label={location.short_name}
                                >
                                  {location.short_name}
                                </MultiSelectorItem>
                              )
                            })}
                          </MultiSelectorList>
                        </MultiSelectorContent>
                      </MultiSelector>
                    </div>
                  )}
                  <FieldDescription>
                    Selecciona las ubicaciones donde quieres que esté disponible el producto.
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </CardContent>
        </Card>

        {/* Product variant */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Variantes</p>

          {/* When no variant card is visible */}
          {variants.length === 0 && (
            <AddButton
              label="Agregar variante"
              onClick={() =>
                variantsAppend({
                  name: "",
                  sequence: variants.length + 1,
                  sku: "",
                  price: 0,
                  original_price: 0,
                  weight: 0,
                  images: [],
                  business_locations: !canManageAllLocations
                    ? businessLocations.map((location) => ({ value: location.business_location_id, label: location.short_name }))
                    : [],
                })
              }
            />
          )}

          {/* When variant card is visible */}
          {/* Render all variant cards */}
          {variants.map((variant, index) => (
            <Card key={variant.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{`Variante ${index + 1}`}</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => variantsRemove(index)}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </CardHeader>

              <CardContent>
                <FieldGroup className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Name */}
                  <Controller
                    name={`variants.${index}.name`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field>
                        <FieldLabel>Nombre</FieldLabel>
                        <Input placeholder="Name" {...field} />
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />

                  {/* Price */}
                  <Controller
                    name={`variants.${index}.price`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field>
                        <FieldLabel>Precio</FieldLabel>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                            <MarketCurrencyCode />
                          </span>
                          <DecimalMoneyInput
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            className="pl-7"
                          />
                        </div>
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />

                  {/* Original price */}
                  <Controller
                    name={`variants.${index}.original_price`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field>
                        <FieldLabel>Precio Original</FieldLabel>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                            <MarketCurrencyCode />
                          </span>
                          <DecimalMoneyInput
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            className="pl-7"
                          />
                        </div>
                        {fieldState.invalid && (
                          <FieldError errors={[fieldState.error]} />
                        )}
                      </Field>
                    )}
                  />
                </FieldGroup>

                {/* Extra fields shown only when "show more" is true */}
                {showMoreVariants && (
                  <div className="mt-6 space-y-6 border-t pt-4">
                    <FieldGroup className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* SKU */}
                      <Controller
                        name={`variants.${index}.sku`}
                        control={form.control}
                        render={({ field, fieldState }) => (
                          <Field>
                            <FieldLabel>SKU</FieldLabel>
                            <Input placeholder="SKU" {...field} />
                            {fieldState.invalid && (
                              <FieldError errors={[fieldState.error]} />
                            )}
                          </Field>
                        )}
                      />

                      {/* Weight */}
                      <Controller
                        name={`variants.${index}.weight`}
                        control={form.control}
                        render={({ field, fieldState }) => (
                          <Field>
                            <FieldLabel>Peso</FieldLabel>
                            <div className="relative">
                              <Input
                                type="text"
                                inputMode="numeric"
                                value={field.value ?? ""}
                                onChange={(e) => {
                                  const raw = e.target.value;

                                  // Allow empty string so the user can delete
                                  if (raw === "") {
                                    field.onChange(0);
                                    return;
                                  }

                                  const num = Number(raw);
                                  if (!isNaN(num)) {
                                    field.onChange(num);
                                  }
                                }}
                                placeholder="Weight"
                                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                g
                              </span>
                            </div>
                            {fieldState.invalid && (
                              <FieldError errors={[fieldState.error]} />
                            )}
                          </Field>
                        )}
                      />
                    </FieldGroup>

                    {/* BUSINESS LOCATION */}
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CardTitle>Ubicaciones</CardTitle>
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-3">
                        <Label className="text-sm font-medium">Ubicaciones disponibles</Label>

                        <VariantLocation
                          index={index}
                          control={form.control}
                          businessLocations={businessLocations}
                        />
                      </CardContent>
                    </Card>

                    {/* Images upload per variant */}
                    <FileUpload
                      key={`variant-image-${index}-${discardRevision}`}
                      bucketName="products"
              pathPrefix={businessId}
                      multiple={true}
                      maxSize={10 * 1024 * 1024}
                      allowedTypes={["image/*"]}
                      existingFiles={
                        (variantsValues[index]?.images ?? []).filter((url) =>
                          (initialVariantImages[index] ?? []).includes(url),
                        )
                      }
                      onExistingFileRemove={(url) => {
                        // Remove the existing file URL from form state
                        const currentImages = form.getValues(`variants.${index}.images`) || [];
                        const updatedImages = currentImages.filter((img) => img !== url);
                        form.setValue(`variants.${index}.images`, updatedImages, {
                          shouldValidate: true,
                          shouldDirty: true,
                        });
                      }}
                      onUploadComplete={(fileData, result) => {
                        // Add the new uploaded file URL to the form state
                        const currentImages = form.getValues(`variants.${index}.images`) || [];
                        form.setValue(`variants.${index}.images`, [...currentImages, result.publicUrl], {
                          shouldValidate: true,
                          shouldDirty: true,
                        });
                      }}
                      onUploadError={(fileData, error) => {
                        console.error("Upload error:", error);
                      }}
                      onFilesChange={(files) => {
                        // Extract newly uploaded publicUrl entries
                        const uploadedUrls = files
                          .filter((f) => f.status === "success" && f.publicUrl)
                          .map((f) => f.publicUrl)
                          .filter((url): url is string => url !== null);

                        // Append to current form images and de-duplicate
                        const currentImages = form.getValues(`variants.${index}.images`) || [];
                        const unique = Array.from(new Set([...currentImages, ...uploadedUrls]));

                        form.setValue(`variants.${index}.images`, unique, {
                          shouldValidate: true,
                          shouldDirty: true,
                        });
                      }}
                      showPreview={true}
                      autoUpload={true}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Show more toggle */}
                <div className="flex justify-center border-t mt-6 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-sm flex items-center gap-1"
                    onClick={() => setShowMoreVariants(!showMoreVariants)}
                  >
                    {showMoreVariants ? (
                      <>
                        Mostrar menos <ChevronUp className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        Mostrar más <ChevronDown className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {/* When there’s at least one variant */}
        {variants.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <AddButton
              label="Agregar variante"
              onClick={() =>
                variantsAppend({
                  name: "",
                  sequence: variants.length + 1,
                  sku: "",
                  price: 0,
                  original_price: 0,
                  weight: 0,
                  images: [],
                  business_locations: !canManageAllLocations
                    ? businessLocations.map((location) => ({ value: location.business_location_id, label: location.short_name }))
                    : [],
                })
              }
            />
            <ReorderDialog
              title="Cambiar secuencia de variantes"
              triggerLabel="Cambiar secuencia de variantes"
              items={dialogVariantsItems}
              getId={(item) => item.id}
              getLabel={(item, index) =>
                item.name?.trim() !== "" ? item.name : `Variante ${index + 1}`
              }
              onSave={(newItems) => {
                const currentValues = form.getValues("variants") ?? [];

                const idToVariant = new Map(
                  currentValues.map((opt, index) => [variants[index].id, opt])
                );

                const sorted = newItems.map((item, index) => {
                  const original = idToVariant.get(item.id)!;
                  return {
                    ...original,
                    sequence: index + 1,
                  };
                });

                variantsReplace(sorted);
              }}
            />
          </div>
        )}
        {/* Product options */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Opciones</p>

          {/* Render all option cards */}
          {options.map((field, index) => (
            <OptionCard
              key={field.id}
              index={index}
              control={form.control}
              remove={optionsRemove}
              setValue={form.setValue}
              locations={businessLocations}
            />
          ))}

          {/* Footer: add option button */}
          <AddButton
            label="Agregar opción"
            onClick={() =>
              optionsAppend({
                name: "",
                sequence: options.length + 1,
                type: "text",
                required: false,
                choices: [],
                validation: undefined,
              })
            }
          />
        </div>

        {/* Attached side/extra groups */}
        {attachedGroupSequences.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Acompañamientos / Extras</p>
              <Link
                href="/admin/products/product-option-groups"
                className="text-xs text-muted-foreground underline"
              >
                Administrar grupos
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">
              El contenido de estos grupos se administra en la página de grupos.
            </p>
            {attachedGroupSequences.map((field, index) => {
              const group = attachedGroupValues[index];
              return (
                <div key={field.id} className="flex items-center gap-3 p-3 border rounded-md">
                  <Badge variant={group?.kind === "side" ? "secondary" : "outline"}>
                    {group?.kind ?? ""}
                  </Badge>
                  <span className="flex-1 text-sm font-medium">{group?.name ?? ""}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Unified sequence dialog — shown when there are 2+ total items across options + groups */}
        {unifiedSeqItems.length > 1 && (
          <ReorderDialog
            title="Secuencia de visualización"
            triggerLabel="Cambiar secuencia"
            items={unifiedSeqItems}
            getId={(item) => item.id}
            getLabel={(item) =>
              `${item.type === "option" ? "Opción" : "Grupo"}: ${item.label}`
            }
            onSave={(newItems) => {
              newItems.forEach((item, i) => {
                const seq = i + 1;
                if (item.type === "option") {
                  const optIdx = options.findIndex((f) => f.id === item.id);
                  if (optIdx !== -1) form.setValue(`options.${optIdx}.sequence`, seq, { shouldDirty: true });
                } else {
                  const grpIdx = attachedGroupSequences.findIndex((f) => f.id === item.id);
                  if (grpIdx !== -1) form.setValue(`attached_group_sequences.${grpIdx}.sequence`, seq, { shouldDirty: true });
                }
              });
            }}
          />
        )}

        <Field orientation="horizontal">
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
        </Field>
      </div>
    </form>
  );
}
// In case it is ever needed but don't use it.
// export function VariantImagesField({
//   control,
//   index,
//   form,
//   basePath,
// }: {
//   control: Control<ProductAddInput>;
//   index: number;
//   form: UseFormReturn<ProductAddInput>;
//   basePath: string;
// }) {
//   // create upload hook
//   const uploadVariantProps = useSupabaseUpload({
//     bucketName: "products",
//     path: `${basePath}`,
//     allowedMimeTypes: ["image/*"],
//     maxFiles: 5,
//     maxFileSize: 2 * 1024 * 1024, // 2MB
//     upsert: true,
//   });

//   // memoize uploaded file keys
//   const uploadedVariantKeys = useMemo(() => {
//     const files = uploadVariantProps.files ?? [];
//     return files
//       .map((f) => (f.name ? `${basePath}/${f.name}` : ""))
//       .filter(Boolean);
//   }, [uploadVariantProps.files, basePath]);

//   // sync with RHF field
//   useEffect(() => {
//     if (uploadVariantProps.isSuccess && uploadedVariantKeys.length >= 0) {
//       form.setValue(`variants.${index}.images`, uploadedVariantKeys, {
//         shouldValidate: true,
//         shouldDirty: true,
//       });
//     }
//   }, [uploadVariantProps.isSuccess, uploadedVariantKeys, index, form]);

//   return (
//     <Controller
//       name={`variants.${index}.images`}
//       control={control}
//       render={() => (
//         <div>
//           <Dropzone {...uploadVariantProps}>
//             <DropzoneEmptyState />
//             <DropzoneContent />
//           </Dropzone>

//           <p className="text-xs text-muted-foreground mt-2">
//             File should not exceed 10 MB. Recommended ratio is 1:1.
//           </p>
//         </div>
//       )}
//     />
//   );
// }
