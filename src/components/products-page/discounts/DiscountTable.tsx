"use client";

import type { DiscountListItem } from "@/lib/types/dashboardTypes";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";

type DiscountTableProps = {
  discounts: DiscountListItem[];
};

function formatAppliesTo(value: string) {
  if (value === "orders") return "Ordenes";
  if (value === "products") return "Productos";
  if (value === "categories") return "Categorias";
  return value;
}

function formatType(value: string) {
  if (value === "code") return "Codigo";
  if (value === "free_delivery") return "Envio gratis";
  return value;
}

function DiscountTableSection({
  discounts,
  emptyMessage,
}: {
  discounts: DiscountListItem[];
  emptyMessage: string;
}) {
  const router = useRouter();

  return (
    <Card>
      <CardContent className="pt-0">
        <Table>
          <TableBody>
            {discounts.length > 0 ? (
              discounts.map((discount) => (
                <TableRow
                  key={discount.discount_id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(`/admin/products/discounts/${discount.discount_id}`)
                  }
                >
                  <TableCell className="py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{discount.title}</span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatType(discount.type)}</span>
                          <span>·</span>
                          <span>{formatAppliesTo(discount.applies_to)}</span>
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          discount.active
                            ? "uppercase bg-emerald-100 text-emerald-700 border-transparent"
                            : "uppercase bg-muted text-muted-foreground"
                        }
                      >
                        {discount.active ? "ACTIVO" : "INACTIVO"}
                      </Badge>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell className="text-center text-sm text-muted-foreground py-8">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function DiscountTable({ discounts }: DiscountTableProps) {
  const activeDiscounts = discounts.filter((discount) => discount.active);
  const inactiveDiscounts = discounts.filter((discount) => !discount.active);

  return (
    <Tabs defaultValue="active" className="w-full">
      <TabsList className="bg-transparent p-0 h-auto rounded-none border-b w-full justify-start gap-6">
        <TabsTrigger
          value="active"
          className="px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-b-foreground"
        >
          Activos
        </TabsTrigger>
        <TabsTrigger
          value="inactive"
          className="px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-b-foreground"
        >
          Inactivos
        </TabsTrigger>
      </TabsList>
      <TabsContent value="active">
        <DiscountTableSection
          discounts={activeDiscounts}
          emptyMessage="No hay descuentos activos."
        />
      </TabsContent>
      <TabsContent value="inactive">
        <DiscountTableSection
          discounts={inactiveDiscounts}
          emptyMessage="No hay descuentos inactivos."
        />
      </TabsContent>
    </Tabs>
  );
}
