"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import type { SelectOption } from "@/lib/types/dashboardTypes";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AddExpressButton({ options }: { options: SelectOption[] }) {
  const [open, setOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  const basePath = useMemo(() => {
    if (!pathname) return "";
    return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  }, [pathname]);

  const handleConfirm = () => {
    if (!selectedTemplate) {
      toast.error("Selecciona un tipo de delivery para continuar.");
      return;
    }
    const nextPath = `${basePath}/${selectedTemplate}`;
    setOpen(false);
    router.push(nextPath);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <Plus className="mr-2 size-4" />
          Agregar delivery
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Selecciona el tipo de delivery</DialogTitle>
          <DialogDescription>
            Elige el tipo en el que quieres basar este nuevo método.
          </DialogDescription>
        </DialogHeader>

        <Select
          value={selectedTemplate}
          onValueChange={setSelectedTemplate}
        >
          <SelectTrigger>
            <SelectValue placeholder="Elegir un tipo" />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm}>
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
