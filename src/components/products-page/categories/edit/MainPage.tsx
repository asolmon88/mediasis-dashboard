"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import CategoryAddEditForm from "@/components/products-page/categories/CategoryAddEditForm";
import { Button } from "@/components/ui/button";
import { ProductCategorySelectable } from "@/lib/types/dashboardTypes";

type EditCategoryMainPageProps = {
  categoryId: string;
  hasChildren: boolean;
  products: ProductCategorySelectable;
  initialCategory: {
    name: string;
    visible: boolean;
    image_url: string | null;
  };
  initialSelectedProducts: {
    product_id: string;
    name: string;
    visibility: boolean;
    first_image: string | null;
  }[];
};

export default function MainPage({
  categoryId,
  hasChildren,
  products,
  initialCategory,
  initialSelectedProducts,
}: EditCategoryMainPageProps) {
  const router = useRouter();

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => router.push("/admin/products/categories")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold">Categoria</h1>
      </div>
      <CategoryAddEditForm
        categoryId={categoryId}
        hasChildren={hasChildren}
        products={products}
        initialValues={initialCategory}
        initialSelectedProducts={initialSelectedProducts}
      />
    </div>
  );
}
