"use client";

import type { DiscountListItem, DiscountTypeOption } from "@/lib/types/dashboardTypes";
import DiscountTable from "./DiscountTable";
import CreateDiscountDialog from "./CreateDiscountDialog";

type DiscountsMainPageProps = {
  discounts: DiscountListItem[];
  discountTypeOptions: DiscountTypeOption[];
};

export default function MainPage({
  discounts,
  discountTypeOptions,
}: DiscountsMainPageProps) {
  return (
    <div className="px-8 pt-2 pb-4 flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Descuentos</h1>
        <CreateDiscountDialog options={discountTypeOptions} />
      </div>
      <DiscountTable discounts={discounts} />
    </div>
  );
}
