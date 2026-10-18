"use client";

import { Button } from "@/components/ui/button";

type UnsavedChangesBarProps = {
  dirty: boolean;
  saving?: boolean;
  onDiscard: () => void;
  onSave?: () => void;
};

export function UnsavedChangesBar({ dirty, saving = false, onDiscard, onSave }: UnsavedChangesBarProps) {
  if (!dirty) return null;

  return (
    <div role="region" aria-label="Cambios sin guardar" className="sticky top-14 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-background/95 p-3 shadow-lg backdrop-blur-md md:top-16">
      <span className="mr-auto text-sm font-medium">Tenés cambios sin guardar</span>
      <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={saving}>Descartar cambios</Button>
      <Button type={onSave ? "button" : "submit"} size="sm" onClick={onSave} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
    </div>
  );
}
