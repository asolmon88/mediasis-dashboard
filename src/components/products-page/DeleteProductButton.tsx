"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deleteProduct } from "@/app/admin/products/[product_id]/actions";
import { Button } from "@/components/ui/button";
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

type DeleteProductButtonProps = {
  productId: string;
  product: {
    images?: string[] | undefined;
    variants?: { images?: string[] | undefined }[] | undefined;
  };
};

export default function DeleteProductButton({ productId, product }: DeleteProductButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    if (!productId) {
      toast.error("No se encontró el identificador del producto");
      return;
    }
    setIsDeleting(true);
    const result = await deleteProduct(productId, product);
    if (!result?.success) {
      toast.error("No se pudo eliminar el producto");
      setIsDeleting(false);
      return;
    }
    toast.success("Producto eliminado");
    router.push("/admin/products");
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive">
          Eliminar producto
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Seguro que quieres borrar el producto?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? "Eliminando..." : "Eliminar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
