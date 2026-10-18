"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import DeliveryForm from "./DeliveryForm";
import { DeliveryInput } from "@/lib/FormSchemas/deliverySchema";
import { deleteDeliveryMethod } from "@/app/admin/app/delivery/edit/[delivery_method_business_id]/actions";

import { BackButton } from "@/components/BackButton";
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

type EditDeliveryMainPageProps = {
  recordId: string;
  defaults: Partial<DeliveryInput>;
  paymentMethods: { id: string; name: string }[];
  canManageAllLocations?: boolean;
  scopeLocked?: boolean;
  canUseMediasisCourier?: boolean;
};

export function EditDeliveryMainPage({
  recordId,
  defaults,
  paymentMethods,
  canManageAllLocations = true,
  scopeLocked = false,
  canUseMediasisCourier = true,
}: EditDeliveryMainPageProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteDeliveryMethod(recordId);
      if (!result.success) {
        toast.error(result.message ?? "No se pudo borrar el método.");
        return;
      }
      toast.success("Método borrado.");
      router.push("/admin/app/delivery");
    });
  };

  return (
    <div className="px-4 py-4 space-y-4">
      <BackButton label="Métodos de delivery" />
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Editar método de delivery</h1>
          {defaults.name ? (
            <p className="text-sm text-muted-foreground">{defaults.name}</p>
          ) : null}
        </div>
        {canManageAllLocations ? <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" disabled={pending}>
              Borrar
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>¿Estás seguro?</DialogTitle>
              <DialogDescription>
                Esta acción eliminará el método de delivery.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmOpen(false);
                  handleDelete();
                }}
                disabled={pending}
              >
                Sí, borrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog> : null}
      </div>

      <div className="flex justify-center">
        <DeliveryForm
          deliveryMethodId={defaults.delivery_method_id ?? ""}
          recordId={recordId}
          defaultValues={defaults}
          paymentMethods={paymentMethods}
          canManageAllLocations={canManageAllLocations}
        scopeLocked={scopeLocked}
        canUseMediasisCourier={canUseMediasisCourier}
        />
      </div>
    </div>
  );
}
