"use server";

import { requireFullProductsAccess, validateLocationSelection } from "@/lib/dashboard/product-authorization";
import {
  DiscountSchema,
  type DiscountCodePayload,
} from "@/lib/FormSchemas/discountSchema";

type UpdateDiscountCodePayload = DiscountCodePayload & {
  discount_id: string;
};

type RpcUpdateDiscountCodeResult = {
  success: boolean;
  message?: string;
  discount_id?: string;
};

function toValidationDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return value;
  const [, day, month, year, hours, minutes] = match;
  return `${year}-${month}-${day}T${hours}:${minutes}:00`;
}

async function resolveDiscountLocationScope(
  discountId: string,
  requestedScope: "all" | "specific",
  requestedIds: string[],
  authorized: Extract<Awaited<ReturnType<typeof requireFullProductsAccess>>, { success: true }>,
) {
  const validation = validateLocationSelection(requestedIds, authorized);
  if (!validation.success) return validation;
  if (authorized.canManageAllLocations) {
    return { success: true as const, scope: requestedScope, ids: requestedIds };
  }
  const { data: discount } = await authorized.admin.schema("mediasis").from("discounts")
    .select("location_scope").eq("discount_id", discountId).eq("business_uid", authorized.businessId).maybeSingle();
  if (!discount) return { success: false as const, message: "Descuento no encontrado." };
  if (discount.location_scope === "all") {
    return { success: true as const, scope: "all" as const, ids: [] as string[] };
  }
  const { data: currentRows } = await authorized.admin.schema("mediasis").from("discount_business_locations")
    .select("business_location_id").eq("discount_id", discountId);
  const protectedIds = (currentRows ?? []).map((row) => row.business_location_id)
    .filter((id) => !authorized.allowedLocationIds.has(id));
  return { success: true as const, scope: "specific" as const, ids: [...new Set([...protectedIds, ...requestedIds])] };
}

export async function updateDiscountCode(payload: UpdateDiscountCodePayload) {
  if (!payload.discount_id) {
    return { success: false, message: "Descuento inválido" };
  }

  const parsed = DiscountSchema.safeParse({
    type: "code",
    active: payload.active,
    title: payload.title,
    starts_at: toValidationDate(payload.starts_at) ?? payload.starts_at,
    ends_at: toValidationDate(payload.ends_at),
    applies_to: payload.applies_to,
    min_requirement_type: payload.min_requirement_type,
    min_amount: payload.min_amount,
    min_items: payload.min_items,
    limit_total_uses: payload.limit_total_uses,
    max_total_uses: payload.max_total_uses,
    limit_per_customer: payload.limit_per_customer,
    max_uses_per_customer: payload.max_uses_per_customer,
    limit_total_discount_amount: payload.limit_total_discount_amount,
    max_total_discount_amount: payload.max_total_discount_amount,
    code: payload.code,
    value_type: payload.value_type,
    percent_value: payload.value_type === "percent" ? payload.value_amount : null,
    fixed_amount:
      payload.value_type === "fixed_amount" ? payload.value_amount : null,
    products: payload.selected_products.map((item) => ({
      product_id: item.value,
    })),
    categories: payload.selected_categories.map((item) => ({
      category_id: item.value,
    })),
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }

  if (
    payload.location_scope === "specific" &&
    (!payload.business_location_ids || payload.business_location_ids.length === 0)
  ) {
    return {
      success: false,
      message: "Debe seleccionar al menos una ubicación",
    };
  }

  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const scope = await resolveDiscountLocationScope(
    payload.discount_id,
    payload.location_scope,
    payload.business_location_ids ?? [],
    authorized,
  );
  if (!scope.success) return scope;
  const supabase = authorized.admin;

  const parsedPayload = parsed.data;
  const selectedProductIds = parsedPayload.products.map(
    (item) => item.product_id,
  );
  const selectedCategoryIds = parsedPayload.categories.map(
    (item) => item.category_id,
  );

  const { data, error } = await supabase.schema("mediasis").rpc("update_discount_code", {
    p_discount_id: payload.discount_id,
    p_business_uid: authorized.businessId,
    p_active: parsedPayload.active,
    p_title: parsedPayload.title,
    p_code: parsedPayload.code,
    p_starts_at_text: payload.starts_at,
    p_ends_at_text: payload.ends_at ?? null,
    p_applies_to: parsedPayload.applies_to,
    p_min_requirement_type: parsedPayload.min_requirement_type,
    p_min_amount: parsedPayload.min_amount,
    p_min_items: parsedPayload.min_items,
    p_limit_total_uses: parsedPayload.limit_total_uses,
    p_max_total_uses: parsedPayload.max_total_uses,
    p_limit_per_customer: parsedPayload.limit_per_customer,
    p_max_uses_per_customer: parsedPayload.max_uses_per_customer,
    p_limit_total_discount_amount: parsedPayload.limit_total_discount_amount,
    p_max_total_discount_amount: parsedPayload.max_total_discount_amount,
    p_location_scope: scope.scope,
    p_business_location_ids:
      scope.scope === "specific"
        ? scope.ids
        : null,
    p_value_type: parsedPayload.value_type,
    p_value_amount:
      parsedPayload.value_type === "percent"
        ? parsedPayload.percent_value
        : parsedPayload.fixed_amount,
    p_selected_product_ids:
      parsedPayload.applies_to === "products" ? selectedProductIds : null,
    p_selected_category_ids:
      parsedPayload.applies_to === "categories" ? selectedCategoryIds : null,
  });

  if (error) {
    console.error(error);
    return { success: false, message: error.message };
  }

  const result = data as RpcUpdateDiscountCodeResult | null;
  if (!result?.success) {
    return {
      success: false,
      message: result?.message ?? "No se pudo actualizar el descuento",
    };
  }

  return {
    success: true,
    message: result.message ?? "Descuento actualizado",
    discount_id: result.discount_id,
  };
}

export async function updateFreeDeliveryDiscount(payload: UpdateDiscountCodePayload) {
  if (!payload.discount_id) {
    return { success: false, message: "Descuento inválido" };
  }

  const parsed = DiscountSchema.safeParse({
    type: "free_delivery",
    active: payload.active,
    title: payload.title,
    starts_at: toValidationDate(payload.starts_at) ?? payload.starts_at,
    ends_at: toValidationDate(payload.ends_at),
    applies_to: payload.applies_to,
    min_requirement_type: payload.min_requirement_type,
    min_amount: payload.min_amount,
    min_items: payload.min_items,
    limit_total_uses: payload.limit_total_uses,
    max_total_uses: payload.max_total_uses,
    limit_per_customer: payload.limit_per_customer,
    max_uses_per_customer: payload.max_uses_per_customer,
    limit_total_discount_amount: false,
    max_total_discount_amount: null,
    code: payload.code,
    value_type: "free_delivery",
    percent_value: null,
    fixed_amount: null,
    products: payload.selected_products.map((item) => ({
      product_id: item.value,
    })),
    categories: payload.selected_categories.map((item) => ({
      category_id: item.value,
    })),
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }

  if (
    payload.location_scope === "specific" &&
    (!payload.business_location_ids || payload.business_location_ids.length === 0)
  ) {
    return {
      success: false,
      message: "Debe seleccionar al menos una ubicación",
    };
  }

  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const scope = await resolveDiscountLocationScope(
    payload.discount_id,
    payload.location_scope,
    payload.business_location_ids ?? [],
    authorized,
  );
  if (!scope.success) return scope;
  const supabase = authorized.admin;

  const parsedPayload = parsed.data;
  const selectedProductIds = parsedPayload.products.map(
    (item) => item.product_id,
  );
  const selectedCategoryIds = parsedPayload.categories.map(
    (item) => item.category_id,
  );

  const { data, error } = await supabase.schema("mediasis").rpc("update_free_delivery_discount", {
    p_discount_id: payload.discount_id,
    p_business_uid: authorized.businessId,
    p_active: parsedPayload.active,
    p_title: parsedPayload.title,
    p_code: parsedPayload.code,
    p_starts_at_text: payload.starts_at,
    p_ends_at_text: payload.ends_at ?? null,
    p_applies_to: parsedPayload.applies_to,
    p_min_requirement_type: parsedPayload.min_requirement_type,
    p_min_amount: parsedPayload.min_amount,
    p_min_items: parsedPayload.min_items,
    p_limit_total_uses: parsedPayload.limit_total_uses,
    p_max_total_uses: parsedPayload.max_total_uses,
    p_limit_per_customer: parsedPayload.limit_per_customer,
    p_max_uses_per_customer: parsedPayload.max_uses_per_customer,
    p_location_scope: scope.scope,
    p_business_location_ids:
      scope.scope === "specific"
        ? scope.ids
        : null,
    p_selected_product_ids:
      parsedPayload.applies_to === "products" ? selectedProductIds : null,
    p_selected_category_ids:
      parsedPayload.applies_to === "categories" ? selectedCategoryIds : null,
  });

  if (error) {
    console.error(error);
    return { success: false, message: error.message };
  }

  const result = data as RpcUpdateDiscountCodeResult | null;
  if (!result?.success) {
    return {
      success: false,
      message: result?.message ?? "No se pudo actualizar el descuento",
    };
  }

  return {
    success: true,
    message: result.message ?? "Descuento actualizado",
    discount_id: result.discount_id,
  };
}
