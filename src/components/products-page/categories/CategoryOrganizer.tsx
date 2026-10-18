"use client";

import { useEffect, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { ProductCategoryTableRow } from "@/lib/types/dashboardTypes";

type Category = ProductCategoryTableRow[number];
type Props = { categories: ProductCategoryTableRow; onSave: (items: ProductCategoryTableRow) => Promise<boolean> };
const INDENT_THRESHOLD = 28;

function SortableRow({ category }: { category: Category }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.product_category_id });
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`flex items-center rounded-md bg-background px-3 py-3 text-sm ${category.parent_category_id ? "ml-8" : ""} ${isDragging ? "z-10 shadow-md ring-1 ring-primary" : ""}`}>
    <button type="button" {...attributes} {...listeners} aria-label={`Mover ${category.name}`} className="mr-3 cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
      <GripVertical className="h-4 w-4" />
    </button>
    <span className="truncate">{category.name}</span>
  </div>;
}

function flattenGroups(items: ProductCategoryTableRow): ProductCategoryTableRow {
  const roots = items.filter((item) => !item.parent_category_id);
  return roots.flatMap((root) => [root, ...items.filter((item) => item.parent_category_id === root.product_category_id)]);
}

export default function CategoryOrganizer({ categories, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ProductCategoryTableRow>(categories);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  useEffect(() => { if (open) { setItems(flattenGroups(categories)); setError(null); } }, [open, categories]);

  const move = ({ active, over, delta }: DragEndEvent) => {
    if (!over) return;
    const activeId = String(active.id);
    const oldIndex = items.findIndex((item) => item.product_category_id === activeId);
    const overIndex = items.findIndex((item) => item.product_category_id === String(over.id));
    if (oldIndex < 0 || overIndex < 0) return;
    const dragged = items[oldIndex];
    const ownsChildren = items.some((item) => item.parent_category_id === activeId);

    // Moving a parent carries its children along as one group.
    if (ownsChildren) {
      if (delta.x > INDENT_THRESHOLD) {
        setError("Mové primero las subcategorías para convertir esta categoría en hija.");
        return;
      }
      const block = [dragged, ...items.filter((item) => item.parent_category_id === activeId)];
      const remaining = items.filter((item) => !block.some((part) => part.product_category_id === item.product_category_id));
      const target = items[overIndex];
      const targetRootId = target.parent_category_id ?? target.product_category_id;
      const targetRootIndex = remaining.findIndex((item) => item.product_category_id === targetRootId);
      if (targetRootIndex < 0) return;
      const insertAt = oldIndex < overIndex
        ? targetRootIndex + 1 + remaining.filter((item) => item.parent_category_id === targetRootId).length
        : targetRootIndex;
      remaining.splice(insertAt, 0, ...block);
      setItems(remaining);
      setError(null);
      return;
    }

    const reordered = arrayMove(items, oldIndex, overIndex);
    const newIndex = reordered.findIndex((item) => item.product_category_id === activeId);
    const previous = reordered[newIndex - 1];
    const previousRootId = previous?.parent_category_id ?? previous?.product_category_id ?? null;
    const previousRoot = reordered.find((item) => item.product_category_id === previousRootId);
    let nextParentId = dragged.parent_category_id;
    if (delta.x >= INDENT_THRESHOLD) {
      if (!previousRoot || previousRoot.product_category_id === activeId || previousRoot.has_products || !previousRoot.visible) {
        setError("La categoría de arriba debe estar visible y no tener productos para recibir subcategorías.");
        return;
      }
      nextParentId = previousRoot.product_category_id;
    } else if (delta.x <= -INDENT_THRESHOLD) {
      nextParentId = null;
    } else if (nextParentId) {
      // Crossing out of the current group also moves a child to the top level.
      nextParentId = previousRootId === nextParentId ? nextParentId : null;
    }
    const updated = reordered.map((item) => item.product_category_id === activeId ? { ...item, parent_category_id: nextParentId } : item);
    setItems(flattenGroups(updated));
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    const ok = await onSave(items.map((item, index) => ({ ...item, sequence: index + 1 })));
    setSaving(false);
    if (ok) setOpen(false);
    else setError("No se pudo guardar la organización. Intentá de nuevo.");
  };

  return <AlertDialog open={open} onOpenChange={setOpen}>
    <AlertDialogTrigger asChild><Button type="button" variant="outline">Cambiar secuencia</Button></AlertDialogTrigger>
    <AlertDialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
      <AlertDialogHeader><AlertDialogTitle>Organizar categorías</AlertDialogTitle></AlertDialogHeader>
      <p className="text-sm text-muted-foreground">Arrastrá para ordenar. Deslizá a la derecha para poner una categoría debajo de la anterior; a la izquierda para sacarla del grupo.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={move}>
        <SortableContext items={items.map((item) => item.product_category_id)} strategy={verticalListSortingStrategy}>
          <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-2">
            {items.map((item) => <SortableRow key={item.product_category_id} category={item} />)}
          </div>
        </SortableContext>
      </DndContext>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button type="button" onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
