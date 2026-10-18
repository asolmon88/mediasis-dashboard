"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { attachGroupToProduct, detachGroupFromProduct } from "@/app/admin/products/product-option-groups/actions";

type Product = { product_id: string; name: string };
type AttachedProduct = { product_id: string; sequence: number; product: { name: string } | { name: string }[] };

type Props = {
  groupId: string;
  kind: "side" | "extra";
  allProducts: Product[];
  initialAttached: AttachedProduct[];
};

export function GroupProductsSection({ groupId, kind, allProducts, initialAttached }: Props) {
  const [attached, setAttached] = useState(initialAttached);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const attachedIds = new Set(attached.map((a) => a.product_id));
  const availableProducts = allProducts.filter((p) => !attachedIds.has(p.product_id));

  const getProductName = (a: AttachedProduct): string => {
    if (Array.isArray(a.product)) return a.product[0]?.name ?? "";
    return (a.product as { name: string }).name;
  };

  const handleAttach = () => {
    if (!selectedProductId) return;
    const nextSequence = attached.length + 1;
    startTransition(async () => {
      const result = await attachGroupToProduct(groupId, selectedProductId, nextSequence);
      if (result.success) {
        const prod = allProducts.find((p) => p.product_id === selectedProductId);
        if (prod) {
          setAttached((prev) => [...prev, { product_id: prod.product_id, sequence: nextSequence, product: { name: prod.name } }]);
        }
        setSelectedProductId("");
        toast.success("Producto adjuntado");
      } else {
        toast.error(result.message ?? "Error al adjuntar");
      }
    });
  };

  const handleDetach = (productId: string) => {
    startTransition(async () => {
      const result = await detachGroupFromProduct(groupId, productId);
      if (result.success) {
        setAttached((prev) => prev.filter((a) => a.product_id !== productId));
        toast.success("Producto removido");
      } else {
        toast.error(result.message ?? "Error al remover");
      }
    });
  };

  const kindLabel = kind === "side" ? "acompañamiento" : "extra";

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Productos que usan este {kindLabel}</h3>

      {attached.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay productos adjuntados.</p>
      ) : (
        <div className="space-y-2">
          {attached.map((a) => (
            <div key={a.product_id} className="flex items-center justify-between p-3 border rounded-md">
              <span className="text-sm">{getProductName(a)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={isPending}
                onClick={() => handleDetach(a.product_id)}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {availableProducts.length > 0 && (
        <div className="flex gap-2">
          <Select value={selectedProductId} onValueChange={setSelectedProductId}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Seleccionar producto…" />
            </SelectTrigger>
            <SelectContent>
              {availableProducts.map((p) => (
                <SelectItem key={p.product_id} value={p.product_id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            disabled={!selectedProductId || isPending}
            onClick={handleAttach}
          >
            Adjuntar
          </Button>
        </div>
      )}

      {availableProducts.length === 0 && attached.length > 0 && (
        <p className="text-xs text-muted-foreground">Todos los productos están adjuntados.</p>
      )}
    </div>
  );
}
