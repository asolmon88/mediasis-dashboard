"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import DiscountAddEditForm from "@/components/products-page/discounts/DiscountAddEditForm";
import { Button } from "@/components/ui/button";
import type {
  DiscountFormBlocksConfig,
  DiscountSelectableCategory,
  DiscountSelectableProduct,
} from "@/lib/types/dashboardTypes";
import type { DiscountCodePayload } from "@/lib/FormSchemas/discountSchema";

type EditDiscountMainPageProps = {
  discountId: string;
  discountType: string;
  discountTypeTitle: string;
  formBlocks: DiscountFormBlocksConfig;
  products: DiscountSelectableProduct[];
  categories: DiscountSelectableCategory[];
  initialValues: DiscountCodePayload;
};

export default function MainPage({
  discountId,
  discountType,
  discountTypeTitle,
  formBlocks,
  products,
  categories,
  initialValues,
}: EditDiscountMainPageProps) {
  const router = useRouter();

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => router.push("/admin/products/discounts")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold">Descuento</h1>
      </div>
      <DiscountAddEditForm
        mode="edit"
        discountId={discountId}
        discountType={discountType}
        discountTypeTitle={discountTypeTitle}
        formBlocks={formBlocks}
        products={products}
        categories={categories}
        initialValues={initialValues}
      />
    </div>
  );
}
