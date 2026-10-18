"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { requestBusinessDeletion } from "./actions";

export function BusinessDeletionCard({ businessName }: { businessName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const canDelete = confirmation.trim().toLocaleLowerCase() === businessName.trim().toLocaleLowerCase();

  function submit() {
    startTransition(async () => {
      const result = await requestBusinessDeletion(confirmation);
      if (!result.success) { toast.error(result.message); return; }
      toast.success("El negocio fue desactivado y su eliminación quedó programada.");
      setOpen(false);
      router.replace("/clerk-auth/onboarding");
      router.refresh();
    });
  }

  return <div className="rounded-2xl border border-destructive/35 bg-destructive/[0.03] p-5">
    <div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 text-destructive" />
      <div className="space-y-1"><h2 className="font-semibold text-destructive">Eliminar negocio</h2>
        <p className="text-sm leading-6 text-muted-foreground">El negocio, su panel y su app de pedidos dejarán de estar disponibles inmediatamente. Conservaremos los datos durante 6 meses por si necesitás recuperarlos; después se eliminarán permanentemente.</p>
      </div>
    </div>
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setConfirmation(""); }}>
      <AlertDialogTrigger asChild><Button variant="destructive" className="mt-5"><Trash2 />Eliminar negocio</Button></AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>¿Eliminar {businessName}?</AlertDialogTitle>
          <AlertDialogDescription>Esta acción desactiva inmediatamente el negocio y revoca el acceso de todos sus miembros. Los datos se conservarán hasta seis meses antes de su eliminación permanente.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2"><Label htmlFor="business-name-confirmation">Escribí <strong>{businessName}</strong> para confirmar</Label>
          <Input id="business-name-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
        </div>
        <AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={(event) => { event.preventDefault(); submit(); }} disabled={!canDelete || pending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{pending ? "Eliminando…" : "Eliminar negocio"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
