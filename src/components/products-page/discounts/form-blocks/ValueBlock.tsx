"use client";

import type {
  DiscountSelectableCategory,
  DiscountSelectableProduct,
} from "@/lib/types/dashboardTypes";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  MultiSelector,
  MultiSelectorContent,
  MultiSelectorInput,
  MultiSelectorItem,
  MultiSelectorList,
  MultiSelectorTrigger,
  type MultiSelectValue,
} from "@/components/ui/multi-select";
import { MarketCurrencyCode } from "@/components/dashboard/MarketCurrencyCode";

type ValueBlockProps = {
  valueType: "percent" | "fixed_amount";
  onValueTypeChange: (value: "percent" | "fixed_amount") => void;
  valueAmount: number;
  onValueAmountChange: (value: number) => void;
  appliesTo: "orders" | "products" | "categories";
  onAppliesToChange: (value: "orders" | "products" | "categories") => void;
  products: DiscountSelectableProduct[];
  categories: DiscountSelectableCategory[];
  selectedProducts: MultiSelectValue[];
  onSelectedProductsChange: (values: MultiSelectValue[]) => void;
  selectedCategories: MultiSelectValue[];
  onSelectedCategoriesChange: (values: MultiSelectValue[]) => void;
};

export default function ValueBlock({
  valueType,
  onValueTypeChange,
  valueAmount,
  onValueAmountChange,
  appliesTo,
  onAppliesToChange,
  products,
  categories,
  selectedProducts,
  onSelectedProductsChange,
  selectedCategories,
  onSelectedCategoriesChange,
}: ValueBlockProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Valor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px]">
          <div className="inline-flex rounded-md bg-muted p-1">
            <button
              type="button"
              onClick={() => onValueTypeChange("percent")}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                valueType === "percent"
                  ? "bg-background ring-2 ring-primary/90"
                  : "text-muted-foreground"
              }`}
            >
              Porcentaje
            </button>
            <button
              type="button"
              onClick={() => onValueTypeChange("fixed_amount")}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                valueType === "fixed_amount"
                  ? "bg-background ring-2 ring-primary/90"
                  : "text-muted-foreground"
              }`}
            >
              Monto fijo
            </button>
          </div>

          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              {valueType === "percent" ? "%" : <MarketCurrencyCode />}
            </span>
            <Input
              type="text"
              inputMode="numeric"
              value={valueAmount}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === "") {
                  onValueAmountChange(0);
                  return;
                }
                const num = Number(raw);
                if (!isNaN(num)) {
                  onValueAmountChange(num);
                }
              }}
              className="h-9 pl-7 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
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
                        <div className="h-10 w-10 rounded-md bg-muted overflow-hidden border">
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
                              ? "uppercase bg-emerald-100 text-emerald-700 border-transparent"
                              : "uppercase bg-muted text-muted-foreground"
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
                              ? "uppercase bg-emerald-100 text-emerald-700 border-transparent"
                              : "uppercase bg-muted text-muted-foreground"
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
