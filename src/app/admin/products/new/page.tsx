'use client'

import { BackButton } from "@/components/BackButton";
import { ComingSoon } from "@/components/ComingSoon";
import AddProductForm from "@/components/products-page/AddProductForm";

export default function AddProductPage() {

  return (
    <div className="px-4 mb-32">
      <BackButton label="Productos"/>

      <div className="flex justify-center">
        <div className="w-full max-w-xl">
          <AddProductForm />
          {/* <ComingSoon /> */}
        </div>
      </div>
    </div>
  );
}
