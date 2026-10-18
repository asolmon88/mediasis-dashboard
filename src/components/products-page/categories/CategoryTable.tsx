"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductCategoryTableRow } from "@/lib/types/dashboardTypes";
import { useRouter } from "next/navigation";

type CategoryTableProps = {
  categories: ProductCategoryTableRow;
};

function CategoryTableSection({
  categories,
  emptyMessage,
}: {
  categories: ProductCategoryTableRow;
  emptyMessage: string;
}) {
  const router = useRouter();

  return (
    <Card>
      <CardContent className="pt-0">
        <Table>
          <TableBody>
            {categories.length > 0 ? (
              categories.map((category) => (
                <TableRow
                  key={category.product_category_id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(
                      `/admin/products/categories/${category.product_category_id}`
                    )
                  }
                >
                  <TableCell className="py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <Checkbox
                          aria-label={`Seleccionar ${category.name}`}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <span className="font-medium">{category.name}</span>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          category.visible
                            ? "uppercase bg-emerald-100 text-emerald-700 border-transparent"
                            : "uppercase bg-muted text-muted-foreground"
                        }
                      >
                        {category.visible ? "VISIBLE" : "OCULTO"}
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

export default function CategoryTable({ categories }: CategoryTableProps) {
  const visibleCategories = categories.filter((category) => category.visible);
  const hiddenCategories = categories.filter((category) => !category.visible);

  return (
    <Tabs defaultValue="visible" className="w-full">
      <TabsList className="bg-transparent p-0 h-auto rounded-none border-b w-full justify-start gap-6">
        <TabsTrigger
          value="visible"
          className="px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-b-foreground"
        >
          Visible
        </TabsTrigger>
        <TabsTrigger
          value="hidden"
          className="px-0 rounded-none border-b-2 border-transparent data-[state=active]:border-b-foreground"
        >
          Oculto
        </TabsTrigger>
      </TabsList>
      <TabsContent value="visible">
        <CategoryTableSection
          categories={visibleCategories}
          emptyMessage="No hay categorias visibles."
        />
      </TabsContent>
      <TabsContent value="hidden">
        <CategoryTableSection
          categories={hiddenCategories}
          emptyMessage="No hay categorias ocultas."
        />
      </TabsContent>
    </Tabs>
  );
}
