"use client";

import { Truck } from "lucide-react";

import type {
  DiscountSelectableCategory,
  DiscountSelectableProduct,
} from "@/lib/types/dashboardTypes";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
  type MultiSelectValue,
} from "@/components/ui/multi-select";

type FreeDeliveryValueBlockProps = {
  appliesTo: "orders" | "products" | "categories";
  onAppliesToChange: (value: "orders" | "products" | "categories") => void;
  products: DiscountSelectableProduct[];
  categories: DiscountSelectableCategory[];
  selectedProducts: MultiSelectValue[];
  onSelectedProductsChange: (values: MultiSelectValue[]) => void;
  selectedCategories: MultiSelectValue[];
  onSelectedCategoriesChange: (values: MultiSelectValue[]) => void;
};

export default function FreeDeliveryValueBlock({
  appliesTo,
  onAppliesToChange,
  products,
  categories,
  selectedProducts,
  onSelectedProductsChange,
  selectedCategories,
  onSelectedCategoriesChange,
}: FreeDeliveryValueBlockProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Valor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm font-medium">
          <Truck className="h-4 w-4 text-muted-foreground" />
          Gratis
        </div>

        <Field className="gap-3">
          <FieldLabel>
            Aplica a <span className="text-destructive">*</span>
          </FieldLabel>
          <div className="space-y-1.5">
            <RadioOption
              checked={appliesTo === "orders"}
              label="Órdenes"
              onClick={() => onAppliesToChange("orders")}
            />
            <RadioOption
              checked={appliesTo === "products"}
              label="Productos específicos"
              onClick={() => onAppliesToChange("products")}
            />
            <RadioOption
              checked={appliesTo === "categories"}
              label="Categorías específicas"
              onClick={() => onAppliesToChange("categories")}
            />
          </div>
        </Field>

        {appliesTo === "products" ? (
          <Field>
            <FieldLabel>Seleccionar productos</FieldLabel>
            <MultiSelector
              values={selectedProducts}
              onValuesChange={onSelectedProductsChange}
              className="w-full"
            >
              <MultiSelectorTrigger>
                <MultiSelectorInput placeholder="Buscar producto" />
              </MultiSelectorTrigger>
              <MultiSelectorContent>
                <MultiSelectorList>
                  {products.map((product) => (
                    <MultiSelectorItem
                      key={product.product_id}
                      value={product.product_id}
                      label={product.name}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted">
                          {product.first_image ? (
                            <img
                              src={product.first_image}
                              alt={product.name}
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        <span className="text-sm font-medium">{product.name}</span>
                        <Badge
                          variant="secondary"
                          className={
                            product.visibility
                              ? "border-transparent bg-emerald-100 text-emerald-700 uppercase"
                              : "bg-muted text-muted-foreground uppercase"
                          }
                        >
                          {product.visibility ? "VISIBLE" : "OCULTO"}
                        </Badge>
                      </div>
                    </MultiSelectorItem>
                  ))}
                </MultiSelectorList>
              </MultiSelectorContent>
            </MultiSelector>
          </Field>
        ) : null}

        {appliesTo === "categories" ? (
          <Field>
            <FieldLabel>Seleccionar categorías</FieldLabel>
            <MultiSelector
              values={selectedCategories}
              onValuesChange={onSelectedCategoriesChange}
              className="w-full"
            >
              <MultiSelectorTrigger>
                <MultiSelectorInput placeholder="Buscar categoría" />
              </MultiSelectorTrigger>
              <MultiSelectorContent>
                <MultiSelectorList>
                  {categories.map((category) => (
                    <MultiSelectorItem
                      key={category.product_category_id}
                      value={category.product_category_id}
                      label={category.name}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{category.name}</span>
                        <Badge
                          variant="secondary"
                          className={
                            category.visible
                              ? "border-transparent bg-emerald-100 text-emerald-700 uppercase"
                              : "bg-muted text-muted-foreground uppercase"
                          }
                        >
                          {category.visible ? "VISIBLE" : "OCULTO"}
                        </Badge>
                      </div>
                    </MultiSelectorItem>
                  ))}
                </MultiSelectorList>
              </MultiSelectorContent>
            </MultiSelector>
          </Field>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RadioOption({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 text-left"
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
          checked ? "border-foreground" : "border-muted-foreground/40"
        }`}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            checked ? "bg-foreground" : "bg-transparent"
          }`}
        />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
