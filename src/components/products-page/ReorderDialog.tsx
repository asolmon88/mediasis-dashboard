"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { GripVertical } from "lucide-react";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type ReorderDialogProps<T> = {
  /** Dialog title, e.g. "Change option sequence" */
  title: string;
  /** Button label, e.g. "Change option sequence" */
  triggerLabel: string;
  /** Save button label */
  saveLabel?: string;
  /** Cancel button label */
  cancelLabel?: string;
  /** Hide cancel button */
  showCancel?: boolean;
  /** Items to reorder */
  items: T[];
  /** How to get a stable id from an item (usually fieldArray item.id) */
  getId: (item: T) => string;
  /** How to show each row label (usually item.name) */
  getLabel: (item: T, index: number) => string;
  /** Called when user clicks Save, with new ordered array */
  onSave: (items: T[]) => void;
};

export function ReorderDialog<T>({
  title,
  triggerLabel,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  showCancel = true,
  items,
  getId,
  getLabel,
  onSave,
}: ReorderDialogProps<T>) {
  const [open, setOpen] = useState(false);
  const [localItems, setLocalItems] = useState<T[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );
  const ids = localItems.map((item) => getId(item));

  // Snapshot items when dialog opens; don't reset while it's open
  useEffect(() => {
    if (open) {
      setLocalItems(items);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setLocalItems((prev) => {
      const oldIndex = prev.findIndex((item) => getId(item) === active.id);
      const newIndex = prev.findIndex((item) => getId(item) === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleSave = () => {
    onSave(localItems);
    setOpen(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full md:w-auto">
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>

        <div className="mt-2 pt-2 border-t border-border">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {ids.map((id, index) => (
                <SortableRow
                  key={id}
                  id={id}
                  label={getLabel(localItems[index], index)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        <AlertDialogFooter className="mt-4 sm:justify-start">
          <Button type="button" onClick={handleSave}>
            {saveLabel}
          </Button>
          {showCancel ? (
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type SortableRowProps = {
  id: string;
  label: string;
};

function SortableRow({ id, label }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className="flex items-center border-b py-2 text-sm cursor-grab"
    >
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="ml-2 truncate">{label}</span>
    </div>
  );
}
