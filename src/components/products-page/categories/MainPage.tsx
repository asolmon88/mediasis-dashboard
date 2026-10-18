"use client";

import { Button } from "@/components/ui/button";
import CategoryTable from "./CategoryTable";
import { ProductCategoryTableRow } from "@/lib/types/dashboardTypes";
import CategoryOrganizer from "./CategoryOrganizer";
import { updateCategoryHierarchy } from "@/app/admin/products/categories/actions";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type CategoriesMainPageProps = {
  categories: ProductCategoryTableRow;
};

export default function MainPage({ categories }: CategoriesMainPageProps) {
  const router = useRouter();

  const handleSequenceSave = async (items: ProductCategoryTableRow) => {
    const result = await updateCategoryHierarchy(items.map((item) => ({ id: item.product_category_id, parent_id: item.parent_category_id, sequence: item.sequence })));
    if (!result.success) {
      toast.error("No se pudo guardar la secuencia");
      return false;
    }
    toast.success("Categorías actualizadas");
    router.refresh();
    return true;
  };

  return (
    <div className="px-8 pt-2 pb-4 flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Categorias</h1>
        <div className="flex items-center gap-2">
          <CategoryOrganizer categories={categories} onSave={handleSequenceSave} />
          <Button type="button" onClick={() => router.push("/admin/products/categories/add")}>
            Crear categoria
          </Button>
        </div>
      </div>
      <CategoryTable categories={categories} />
    </div>
  );
}
