"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MultiSelectValue } from "@/components/ui/multi-select";
import type {
  DiscountFormBlocksConfig,
  DiscountSelectableCategory,
  DiscountSelectableProduct,
} from "@/lib/types/dashboardTypes";
import { Button } from "@/components/ui/button";
import { UnsavedChangesBar } from "@/components/forms/UnsavedChangesBar";
import {
  createDiscountCode,
  createFreeDeliveryDiscount,
} from "@/app/admin/products/discounts/add/[discount_type]/actions";
import {
  updateDiscountCode,
  updateFreeDeliveryDiscount,
} from "@/app/admin/products/discounts/[discount_id]/actions";
import type { DiscountCodePayload } from "@/lib/FormSchemas/discountSchema";

import TitleBlock from "@/components/products-page/discounts/form-blocks/TitleBlock";
import MinimumPurchaseBlock from "@/components/products-page/discounts/form-blocks/MinimumPurchaseBlock";
import MaximumUsesBlock from "@/components/products-page/discounts/form-blocks/MaximumUsesBlock";
import ActiveBlock from "@/components/products-page/discounts/form-blocks/ActiveBlock";
import LocationsBlock from "@/components/products-page/discounts/form-blocks/LocationsBlock";
import ValueBlock from "@/components/products-page/discounts/form-blocks/ValueBlock";
import FreeDeliveryValueBlock from "@/components/products-page/discounts/form-blocks/FreeDeliveryValueBlock";
import { useDashboardAuthorization } from "@/components/dashboard/DashboardAuthProvider";

type DiscountAddEditFormProps = {
  mode?: "create" | "edit";
  discountId?: string;
  discountType: string;
  discountTypeTitle: string;
  formBlocks: DiscountFormBlocksConfig;
  products: DiscountSelectableProduct[];
  categories: DiscountSelectableCategory[];
  initialValues?: DiscountCodePayload;
};

export default function DiscountAddEditForm({
  mode = "create",
  discountId,
  discountType,
  discountTypeTitle,
  formBlocks,
  products,
  categories,
  initialValues,
}: DiscountAddEditFormProps) {
  const router = useRouter();

  const formatDateToUtcText = (date: Date) => {
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const year = date.getUTCFullYear();
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  const formatCurrentDateTimeUtc = () => formatDateToUtcText(new Date());

  const toUtcTextFromInput = (value: string): string | null => {
    const trimmed = value.trim();
    const match = trimmed.match(
      /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/,
    );
    if (!match) return null;

    const [, day, month, year, hours, minutes] = match;
    const localDate = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      0,
      0,
    );
    if (Number.isNaN(localDate.getTime())) return null;

    return formatDateToUtcText(localDate);
  };

  const [isActive, setIsActive] = useState(initialValues?.active ?? true);
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [code, setCode] = useState(initialValues?.code ?? "");
  const [valueType, setValueType] = useState<"percent" | "fixed_amount" | "free_delivery">(
    initialValues?.value_type ?? (discountType === "free_delivery" ? "free_delivery" : "percent"),
  );
  const [valueAmount, setValueAmount] = useState(initialValues?.value_amount ?? 0);
  const [appliesTo, setAppliesTo] = useState<"orders" | "products" | "categories">(
    initialValues?.applies_to ?? "orders",
  );
  const [selectedProducts, setSelectedProducts] = useState<MultiSelectValue[]>(
    initialValues?.selected_products ?? [],
  );
  const [selectedCategories, setSelectedCategories] = useState<MultiSelectValue[]>(
    initialValues?.selected_categories ?? [],
  );
  const [minimumRequirementType, setMinimumRequirementType] = useState<
    "none" | "min_amount" | "min_items"
  >(initialValues?.min_requirement_type ?? "none");
  const [minAmount, setMinAmount] = useState(initialValues?.min_amount ?? 0);
  const [minItems, setMinItems] = useState(initialValues?.min_items ?? 0);
  const [limitTotalUses, setLimitTotalUses] = useState(
    initialValues?.limit_total_uses ?? false,
  );
  const [maxTotalUses, setMaxTotalUses] = useState(initialValues?.max_total_uses ?? 0);
  const [limitPerCustomer, setLimitPerCustomer] = useState(
    initialValues?.limit_per_customer ?? false,
  );
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState(
    initialValues?.max_uses_per_customer ?? 0,
  );
  const [limitTotalDiscountAmount, setLimitTotalDiscountAmount] = useState(
    initialValues?.limit_total_discount_amount ?? false,
  );
  const [maxTotalDiscountAmount, setMaxTotalDiscountAmount] = useState(
    initialValues?.max_total_discount_amount ?? 0,
  );
  const [startDate, setStartDate] = useState(
    initialValues?.starts_at ?? formatCurrentDateTimeUtc(),
  );
  const [hasEndDate, setHasEndDate] = useState(Boolean(initialValues?.ends_at));
  const [endDate, setEndDate] = useState(
    initialValues?.ends_at ?? formatCurrentDateTimeUtc(),
  );
  const authorization = useDashboardAuthorization();
  const businessLocations = authorization.locations;
  const canManageAllLocations = authorization.mode === "legacy" || authorization.allLocations;
  const [availableEverywhere, setAvailableEverywhere] = useState(
    initialValues?.location_scope
      ? initialValues.location_scope === "all"
      : true,
  );
  const [selectedLocations, setSelectedLocations] = useState<MultiSelectValue[]>(
    (initialValues?.business_location_ids ?? []).map((locationId) => ({
      value: locationId,
      label: locationId,
    })),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const initializedRestrictedLocations = useRef(false);

  const currentState = {
    isActive, title, code, valueType, valueAmount, appliesTo,
    selectedProducts, selectedCategories, minimumRequirementType, minAmount, minItems,
    limitTotalUses, maxTotalUses, limitPerCustomer, maxUsesPerCustomer,
    limitTotalDiscountAmount, maxTotalDiscountAmount, startDate, hasEndDate, endDate,
    availableEverywhere, selectedLocations: selectedLocations.map((item) => item.value),
  };
  const initialState = useRef(currentState);
  const hasChanges = JSON.stringify(currentState) !== JSON.stringify(initialState.current);
  const discardChanges = () => {
    const saved = initialState.current;
    setIsActive(saved.isActive); setTitle(saved.title); setCode(saved.code);
    setValueType(saved.valueType); setValueAmount(saved.valueAmount); setAppliesTo(saved.appliesTo);
    setSelectedProducts(saved.selectedProducts); setSelectedCategories(saved.selectedCategories);
    setMinimumRequirementType(saved.minimumRequirementType); setMinAmount(saved.minAmount); setMinItems(saved.minItems);
    setLimitTotalUses(saved.limitTotalUses); setMaxTotalUses(saved.maxTotalUses);
    setLimitPerCustomer(saved.limitPerCustomer); setMaxUsesPerCustomer(saved.maxUsesPerCustomer);
    setLimitTotalDiscountAmount(saved.limitTotalDiscountAmount); setMaxTotalDiscountAmount(saved.maxTotalDiscountAmount);
    setStartDate(saved.startDate); setHasEndDate(saved.hasEndDate); setEndDate(saved.endDate);
    setAvailableEverywhere(saved.availableEverywhere);
    setSelectedLocations(saved.selectedLocations.map((value) => ({
      value, label: businessLocations.find((location) => location.business_location_id === value)?.short_name ?? value,
    })));
  };

  useEffect(() => {
    if (!canManageAllLocations && !initialValues && !initializedRestrictedLocations.current) {
      initializedRestrictedLocations.current = true;
      initialState.current = {
        ...initialState.current,
        availableEverywhere: false,
        selectedLocations: businessLocations.map((location) => location.business_location_id),
      };
      setAvailableEverywhere(false);
      setSelectedLocations(
        businessLocations.map((location) => ({ value: location.business_location_id, label: location.short_name })),
      );
    }
  }, [businessLocations, canManageAllLocations, initialValues]);

  useEffect(() => {
    setSelectedLocations((current) =>
      current.map((location) => {
        const locationData = businessLocations.find(
          (item) => item.business_location_id === location.value,
        );
        return locationData
          ? { value: location.value, label: locationData.short_name }
          : location;
      }),
    );
  }, [businessLocations]);

  const handleAppliesToChange = (value: "orders" | "products" | "categories") => {
    setAppliesTo(value);
    if (value !== "products") {
      setSelectedProducts([]);
    }
    if (value !== "categories") {
      setSelectedCategories([]);
    }
  };

  const handleMinimumRequirementTypeChange = (
    value: "none" | "min_amount" | "min_items",
  ) => {
    setMinimumRequirementType(value);
    if (value !== "min_amount") {
      setMinAmount(0);
    }
    if (value !== "min_items") {
      setMinItems(0);
    }
  };

  const handleLimitTotalUsesChange = (checked: boolean) => {
    setLimitTotalUses(checked);
    if (!checked) {
      setMaxTotalUses(0);
    }
  };

  const handleLimitPerCustomerChange = (checked: boolean) => {
    setLimitPerCustomer(checked);
    if (!checked) {
      setMaxUsesPerCustomer(0);
    }
  };

  const handleLimitTotalDiscountAmountChange = (checked: boolean) => {
    setLimitTotalDiscountAmount(checked);
    if (!checked) {
      setMaxTotalDiscountAmount(0);
    }
  };

  const handleHasEndDateChange = (checked: boolean) => {
    setHasEndDate(checked);
    if (checked && !endDate) {
      setEndDate(formatCurrentDateTimeUtc());
    }
  };

  const handleAvailableEverywhereChange = (checked: boolean) => {
    setAvailableEverywhere(checked);
    if (checked) {
      setSelectedLocations([]);
    }
  };

  const handleSelectedLocationsChange = (values: MultiSelectValue[]) => {
    setSelectedLocations(values);
    setAvailableEverywhere(values.length === 0);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const isFreeDelivery = discountType === "free_delivery";
      const startsAtUtcText = toUtcTextFromInput(startDate);
      if (!startsAtUtcText) {
        toast.error("Formato inválido en la fecha de inicio");
        return;
      }

      const endsAtUtcText = hasEndDate ? toUtcTextFromInput(endDate) : null;
      if (hasEndDate && !endsAtUtcText) {
        toast.error("Formato inválido en la fecha de finalización");
        return;
      }

      const payload: DiscountCodePayload = {
        type: isFreeDelivery ? "free_delivery" : "code",
        active: isActive,
        title,
        code: discountType === "code" || isFreeDelivery ? code : "",
        value_type: isFreeDelivery ? "free_delivery" : valueType,
        value_amount: isFreeDelivery ? 0 : valueAmount,
        applies_to: appliesTo,
        selected_products: selectedProducts,
        selected_categories: selectedCategories,
        min_requirement_type: minimumRequirementType,
        min_amount: minimumRequirementType === "min_amount" ? minAmount : null,
        min_items: minimumRequirementType === "min_items" ? minItems : null,
        limit_total_uses: limitTotalUses,
        max_total_uses: limitTotalUses ? maxTotalUses : null,
        limit_per_customer: limitPerCustomer,
        max_uses_per_customer: limitPerCustomer ? maxUsesPerCustomer : null,
        limit_total_discount_amount: isFreeDelivery ? false : limitTotalDiscountAmount,
        max_total_discount_amount:
          !isFreeDelivery && limitTotalDiscountAmount ? maxTotalDiscountAmount : null,
        starts_at: startsAtUtcText,
        ends_at: hasEndDate ? endsAtUtcText : null,
        location_scope: availableEverywhere ? "all" : "specific",
        business_location_ids: selectedLocations.map((location) => location.value),
      };

      const currentDiscountId = discountId;
      if (mode === "edit" && !currentDiscountId) {
        toast.error("No se pudo identificar el descuento");
        return;
      }

      let result: Awaited<ReturnType<typeof createDiscountCode>>;
      if (mode === "edit") {
        result = isFreeDelivery
          ? await updateFreeDeliveryDiscount({
              ...payload,
              discount_id: currentDiscountId!,
            })
          : await updateDiscountCode({
              ...payload,
              discount_id: currentDiscountId!,
            });
      } else {
        result = isFreeDelivery
          ? await createFreeDeliveryDiscount(payload)
          : await createDiscountCode(payload);
      }

      if (!result.success) {
        toast.error(
          result.message ??
            (mode === "edit"
              ? "No se pudo actualizar el descuento"
              : "No se pudo crear el descuento"),
        );
        return;
      }

      toast.success(mode === "edit" ? "Descuento actualizado" : "Descuento creado");
      router.push("/admin/products/discounts");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <UnsavedChangesBar dirty={hasChanges} saving={isSubmitting} onDiscard={discardChanges} />
      <div className="flex flex-col gap-4">
        {formBlocks.showGeneralBlock ? (
          <TitleBlock
            discountType={discountType}
            discountTypeTitle={discountTypeTitle}
            isActive={isActive}
            onActiveChange={setIsActive}
            title={title}
            onTitleChange={setTitle}
            code={code}
            onCodeChange={setCode}
          />
        ) : null}

        {formBlocks.showValueBlock && discountType === "free_delivery" ? (
          <FreeDeliveryValueBlock
            appliesTo={appliesTo}
            onAppliesToChange={handleAppliesToChange}
            products={products}
            categories={categories}
            selectedProducts={selectedProducts}
            onSelectedProductsChange={setSelectedProducts}
            selectedCategories={selectedCategories}
            onSelectedCategoriesChange={setSelectedCategories}
          />
        ) : null}

        {formBlocks.showValueBlock && discountType !== "free_delivery" ? (
          <ValueBlock
            valueType={valueType === "free_delivery" ? "percent" : valueType}
            onValueTypeChange={setValueType}
            valueAmount={valueAmount}
            onValueAmountChange={setValueAmount}
            appliesTo={appliesTo}
            onAppliesToChange={handleAppliesToChange}
            products={products}
            categories={categories}
            selectedProducts={selectedProducts}
            onSelectedProductsChange={setSelectedProducts}
            selectedCategories={selectedCategories}
            onSelectedCategoriesChange={setSelectedCategories}
          />
        ) : null}

        {formBlocks.showMinimumRequirementsBlock ? (
          <MinimumPurchaseBlock
            minimumRequirementType={minimumRequirementType}
            onMinimumRequirementTypeChange={handleMinimumRequirementTypeChange}
            minAmount={minAmount}
            onMinAmountChange={setMinAmount}
            minItems={minItems}
            onMinItemsChange={setMinItems}
          />
        ) : null}

        {formBlocks.showMaximumUsesBlock ? (
          <MaximumUsesBlock
            limitTotalUses={limitTotalUses}
            onLimitTotalUsesChange={handleLimitTotalUsesChange}
            maxTotalUses={maxTotalUses}
            onMaxTotalUsesChange={setMaxTotalUses}
            limitPerCustomer={limitPerCustomer}
            onLimitPerCustomerChange={handleLimitPerCustomerChange}
            maxUsesPerCustomer={maxUsesPerCustomer}
            onMaxUsesPerCustomerChange={setMaxUsesPerCustomer}
            limitTotalDiscountAmount={limitTotalDiscountAmount}
            onLimitTotalDiscountAmountChange={handleLimitTotalDiscountAmountChange}
            maxTotalDiscountAmount={maxTotalDiscountAmount}
            onMaxTotalDiscountAmountChange={setMaxTotalDiscountAmount}
            showTotalDiscountAmountLimit={discountType !== "free_delivery"}
          />
        ) : null}

        {formBlocks.showActiveDatesBlock ? (
          <ActiveBlock
            startDate={startDate}
            onStartDateChange={setStartDate}
            hasEndDate={hasEndDate}
            onHasEndDateChange={handleHasEndDateChange}
            endDate={endDate}
            onEndDateChange={setEndDate}
          />
        ) : null}

        {formBlocks.showTargetsBlock ? (
          <LocationsBlock
            availableEverywhere={availableEverywhere}
            onAvailableEverywhereChange={handleAvailableEverywhereChange}
            selectedLocations={selectedLocations}
            onSelectedLocationsChange={handleSelectedLocationsChange}
            businessLocations={businessLocations}
            canManageAllLocations={canManageAllLocations}
          />
        ) : null}

        <div className="flex justify-start">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              "Guardar"
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
