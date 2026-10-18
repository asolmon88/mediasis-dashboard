import AddProductButton from "./AddProductButton";
import ProductsTable from "./ProductsTable";
import type { ProductView } from "@/lib/types/dashboardTypes";

export default function MainPage({ initialProducts }: { initialProducts: ProductView }) {
  return (
    <div className="px-8 pt-2 pb-4 flex flex-col space-y-4">
      <div className="flex w-full justify-end">
        <AddProductButton />
      </div>
      <ProductsTable initialProducts={initialProducts} />
    </div>
  );
}
