"use client";

import { useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { CategoryAddInput, CategoryAddSchema } from "@/lib/FormSchemas/categorySchema";
import { ProductCategorySelectable } from "@/lib/types/dashboardTypes";
import { addCategory } from "@/app/admin/products/categories/add/actions";
import { deleteCategory, updateCategory } from "@/app/admin/products/categories/[category_id]/actions";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UnsavedChangesBar } from "@/components/forms/UnsavedChangesBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import FileUpload from "@/components/file-upload";

type CategoryAddEditFormProps = {
  products: ProductCategorySelectable;
  categoryId?: string;
  hasChildren?: boolean;
  initialValues?: {
    name: string;
    visible: boolean;
    image_url: string | null;
  };
  initialSelectedProducts?: SelectedProduct[];
};

type SelectedProduct = {
  product_id: string;
  name: string;
  visibility: boolean;
  first_image: string | null;
};

export default function CategoryAddEditForm({
  products,
  categoryId,
  hasChildren = false,
  initialValues,
  initialSelectedProducts = [],
}: CategoryAddEditFormProps) {
  const normalizedInitialSelectedProducts = useMemo(() => {
    const seen = new Set<string>();
    const next: SelectedProduct[] = [];

    for (const product of initialSelectedProducts) {
      if (!product.product_id || seen.has(product.product_id)) continue;
      seen.add(product.product_id);
      next.push(product);
    }

    return next;
  }, [initialSelectedProducts]);

  const router = useRouter();
  const authorization = useDashboardAuthorization();
  const businessId = authorization.activeBusinessId ?? "categories";
  const [open, setOpen] = useState(false);
  const [discardRevision, setDiscardRevision] = useState(0);
  const [selectedProducts, setSelectedProducts] =
    useState<SelectedProduct[]>(normalizedInitialSelectedProducts);

  const form = useForm<CategoryAddInput>({
    resolver: zodResolver(CategoryAddSchema),
    defaultValues: {
      name: initialValues?.name ?? "",
      visible: initialValues?.visible ?? true,
      image_url: initialValues?.image_url ?? null,
      products:
        normalizedInitialSelectedProducts.length > 0
          ? normalizedInitialSelectedProducts.map((item, index) => ({
              product_id: item.product_id,
              sequence: index + 1,
            }))
          : [],
    },
  });

  const imageUrl = form.watch("image_url");
  const existingFiles = imageUrl ? [imageUrl] : [];

  const availableProducts = useMemo(() => {
    const selectedIds = new Set(selectedProducts.map((product) => product.product_id));
    return products.filter((product) => !selectedIds.has(product.product_id));
  }, [products, selectedProducts]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const updateFormProducts = (items: SelectedProduct[]) => {
    form.setValue(
      "products",
      items.map((item, index) => ({
        product_id: item.product_id,
        sequence: index + 1,
      })),
      { shouldDirty: true, shouldValidate: true }
    );
  };

  const handleSelectProduct = (product: SelectedProduct) => {
    const next = [...selectedProducts, product];
    setSelectedProducts(next);
    updateFormProducts(next);
    setOpen(false);
  };

  const handleRemoveProduct = (productId: string) => {
    const next = selectedProducts.filter((product) => product.product_id !== productId);
    setSelectedProducts(next);
    updateFormProducts(next);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setSelectedProducts((prev) => {
      const oldIndex = prev.findIndex((item) => item.product_id === active.id);
      const newIndex = prev.findIndex((item) => item.product_id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      updateFormProducts(next);
      return next;
    });
  };

  async function onSubmit(values: CategoryAddInput) {
    const parsed = CategoryAddSchema.safeParse(values);
    if (!parsed.success) {
      toast.error("Datos invalidos");
      return;
    }
    const result = categoryId
      ? await updateCategory(categoryId, parsed.data)
      : await addCategory(parsed.data);
    if (!result.success) {
      toast.error("No se pudo guardar la categoria");
      return;
    }
    toast.success(categoryId ? "Categoria actualizada" : "Categoria creada");
    router.push("/admin/products/categories");
  }

  const handleDelete = async () => {
    if (!categoryId) return;
    const result = await deleteCategory(categoryId);
    if (!result.success) {
      toast.error("No se pudo eliminar la categoria");
      return;
    }
    toast.success("Categoria eliminada");
    router.push("/admin/products/categories");
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <UnsavedChangesBar dirty={form.formState.isDirty} onDiscard={() => {
        form.reset();
        setSelectedProducts(normalizedInitialSelectedProducts);
        setDiscardRevision((value) => value + 1);
      }} />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid grid-cols-1 gap-6">
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel>Nombre *</FieldLabel>
                    <Input placeholder="Nombre" {...field} />
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <Controller
                name="visible"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field>
                    <FieldLabel>Visibilidad *</FieldLabel>
                    <Select
                      disabled={hasChildren}
                      value={field.value ? "visible" : "hidden"}
                      onValueChange={(val) => field.onChange(val === "visible")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Visibilidad" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="visible">Visible</SelectItem>
                        <SelectItem value="hidden">Oculto</SelectItem>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                  </Field>
                )}
              />

              <Field>
                <FieldLabel>Imagen</FieldLabel>
                <FileUpload
                  key={`category-image-${discardRevision}`}
                  bucketName="categories"
                  pathPrefix={businessId}
                  multiple={false}
                  maxSize={10 * 1024 * 1024}
                  allowedTypes={["image/*"]}
                  existingFiles={existingFiles}
                  onExistingFileRemove={() => {
                    form.setValue("image_url", null, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                  onUploadComplete={(fileData, result) => {
                    form.setValue("image_url", result.publicUrl, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                  onUploadError={(fileData, error) => {
                    console.error("Upload error:", error);
                    toast.error("No se pudo subir la imagen");
                  }}
                  onFilesChange={(files) => {
                    const uploaded = files.find((file) => file.status === "success" && file.publicUrl);
                    if (uploaded?.publicUrl) {
                      form.setValue("image_url", uploaded.publicUrl, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }
                  }}
                  showPreview={true}
                  autoUpload={true}
                  className="w-full"
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        {!hasChildren && <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Productos</CardTitle>
            <Badge variant="outline" className="uppercase">
              TOTAL {selectedProducts.length}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Field>
                <FieldLabel>Agregar producto</FieldLabel>
                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between">
                      Buscar producto
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[320px]" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar producto" />
                      <CommandList>
                        <CommandEmpty>No hay resultados.</CommandEmpty>
                        <CommandGroup>
                          {availableProducts.map((product) => (
                            <CommandItem
                              key={product.product_id}
                              onSelect={() => handleSelectProduct(product)}
                              className="flex items-center gap-3"
                            >
                              <div className="h-10 w-10 rounded-md bg-muted overflow-hidden border">
                                {product.first_image ? (
                                  <img
                                    src={product.first_image}
                                    alt={product.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : null}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium">{product.name}</p>
                              </div>
                              <Badge
                                variant="secondary"
                                className={
                                  product.visibility
                                    ? "uppercase bg-emerald-100 text-emerald-700 border-transparent"
                                    : "uppercase bg-muted text-muted-foreground"
                                }
                              >
                                {product.visibility ? "VISIBLE" : "OCULTO"}
                              </Badge>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </Field>

              {selectedProducts.length > 0 ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={selectedProducts.map((item) => item.product_id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {selectedProducts.map((product) => (
                        <SortableProductRow
                          key={product.product_id}
                          product={product}
                          onRemove={() => handleRemoveProduct(product.product_id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="text-sm text-muted-foreground">Sin productos seleccionados.</div>
              )}
            </div>
          </CardContent>
        </Card>}

        {hasChildren && <p className="text-sm text-muted-foreground">Esta categoría contiene subcategorías. Movelas fuera en Cambiar secuencia antes de ocultarla, agregar productos o eliminarla.</p>}
        <div className="flex items-center justify-between">
          <Button type="submit">Guardar</Button>
          {categoryId && !hasChildren ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive">
                  Eliminar categoria
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Eliminar categoria</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta accion eliminara la categoria y su imagen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>
    </form>
  );
}

type SortableProductRowProps = {
  product: SelectedProduct;
  onRemove: () => void;
};

function SortableProductRow({ product, onRemove }: SortableProductRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: product.product_id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-4 rounded-md border p-2"
    >
      <div className="flex items-center gap-3">
        <button type="button" className="text-muted-foreground cursor-grab" {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="h-10 w-10 rounded-md bg-muted overflow-hidden border">
          {product.first_image ? (
            <img src={product.first_image} alt={product.name} className="h-full w-full object-cover" />
          ) : null}
        </div>
        <span className="text-sm font-medium text-primary">{product.name}</span>
        <Badge
          variant="secondary"
          className={
            product.visibility
              ? "uppercase bg-emerald-100 text-emerald-700 border-transparent"
              : "uppercase bg-muted text-muted-foreground"
          }
        >
          {product.visibility ? "VISIBLE" : "OCULTO"}
        </Badge>
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
