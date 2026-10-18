"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import Image from "next/image";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { ProductView } from "@/lib/types/dashboardTypes";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { deleteProduct, duplicateProduct, updateProductVisibility } from "@/app/admin/products/actions";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

export default function ProductsTable({ initialProducts }: { initialProducts: ProductView }) {
  const market = useDashboardAuthorization().market;
  if (!market) throw new Error("El negocio no tiene configuración regional.");
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<ProductView>(initialProducts)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const router = useRouter();

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleToggleVisibility(productId: string, nextVisibility: boolean) {
    setActionLoadingId(productId);
    const result = await updateProductVisibility(productId, nextVisibility);
    if (!result?.success) {
      toast.error("No se pudo actualizar la visibilidad");
      setActionLoadingId(null);
      return;
    }
    setProducts((prev) =>
      prev.map((product) =>
        product.product_id === productId
          ? { ...product, visibility: nextVisibility }
          : product,
      ),
    );
    setActionLoadingId(null);
  }

  async function handleDeleteProduct() {
    if (!deleteTarget) return;
    setActionLoadingId(deleteTarget);
    const target = products.find((product) => product.product_id === deleteTarget);
    const result = await deleteProduct(deleteTarget, {
      images: target?.images ?? [],
    });
    if (!result?.success) {
      toast.error("No se pudo eliminar el producto");
      setActionLoadingId(null);
      return;
    }
    setProducts((prev) => prev.filter((product) => product.product_id !== deleteTarget));
    setDeleteTarget(null);
    setActionLoadingId(null);
    toast.success("Producto eliminado");
  }

  async function handleDuplicateProduct(productId: string) {
    setActionLoadingId(productId);
    const result = await duplicateProduct(productId);
    if (!result?.success) {
      toast.error("No se pudo duplicar el producto");
      setActionLoadingId(null);
      return;
    }
    toast.success("Producto duplicado");
    window.location.reload();
  }

  return (
    <>
      <Card>
          <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <CardTitle className="font-medium text-[15px]">
              Todos los productos
            </CardTitle>

            {/* Search Bar */}
            <div className="w-full md:w-1/3">
              <Input
                type="text"
                placeholder="Buscar producto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm"
              />
            </div>
          </CardHeader>

          <CardContent>
            <Table>
              <TableBody>
                {filteredProducts.length > 0 ? (
                  filteredProducts.map((product) => (
                    <TableRow key={product.product_id}>
                      <TableCell className="font-medium cursor-pointer" onClick={ () => {
                          router.push(`/admin/products/${product.product_id}`)
                        }
                      }>
                        <div className="flex flex-row items-center gap-4">
                          {/* Product Image */}
                          {product.images && product.images.length > 0 && (
                            <div className="relative w-14 h-14 rounded-md overflow-hidden border">
                              <Image
                                src={product.images && product.images.length > 0 ? product.images[0] : ''}
                                alt={product.name}
                                fill
                                className="object-cover"
                              />
                            </div>
                          )}

                          {/* Text Section */}
                          <div className="flex flex-col justify-center">
                            {/* Product Name */}
                            <span className="font-semibold text-sm">
                              {product.name}
                            </span>

                            {/* Price, Category, and Status */}
                            <div className="flex flex-row items-center gap-2 text-xs text-muted-foreground">
                              <span>{new Intl.NumberFormat(market.locale, {
                                style: "currency", currency: market.currencyCode,
                              }).format(product.price)}</span>
                              <span>·</span>
                              <span>{product.categories[0]}</span>
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
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="w-12">
                        <div className="flex justify-end">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleDuplicateProduct(product.product_id);
                                }}
                                disabled={actionLoadingId === product.product_id}
                              >
                                Duplicar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleToggleVisibility(
                                    product.product_id,
                                    !product.visibility,
                                  );
                                }}
                                disabled={actionLoadingId === product.product_id}
                              >
                                {product.visibility ? "Ocultar" : "Visible"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setDeleteTarget(product.product_id);
                                }}
                                className="text-destructive focus:text-destructive"
                                disabled={actionLoadingId === product.product_id}
                              >
                                Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell className="text-center text-sm text-muted-foreground py-8">
                      No se encontraron productos.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => {
        if (!open) setDeleteTarget(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Seguro que quieres borrar el producto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!actionLoadingId}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProduct}
              disabled={!!actionLoadingId}
            >
              {actionLoadingId ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
