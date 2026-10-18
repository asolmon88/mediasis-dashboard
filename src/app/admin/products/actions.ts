"use server";

import { requireFullProductsAccess, requireProductAccess } from "@/lib/dashboard/product-authorization";
import { deleteProduct as deleteProductWithImages } from "./[product_id]/actions";

export async function updateProductVisibility(productId: string, visibility: boolean) {
  if (!productId) {
    return { success: false, message: "Missing product identifier" };
  }

  const authorized = await requireProductAccess(productId);
  if (!authorized.success) return authorized;
  const { error } = await authorized.admin
    .schema("mediasis")
    .from("product")
    .update({ visibility })
    .eq("product_id", productId);

  if (error) {
    console.error(error);
    return { success: false, message: error };
  }

  return { success: true };
}

export const deleteProduct = deleteProductWithImages;

export async function duplicateProduct(productId: string) {
  if (!productId) {
    return { success: false, message: "Missing product identifier" };
  }

  const authorized = await requireProductAccess(productId);
  if (!authorized.success) return authorized;
  const { data, error } = await authorized.admin
    .schema("mediasis")
    .rpc("duplicate_product_for_dashboard", {
      p_business_id: authorized.businessId,
      p_product_id: productId,
    });

  if (error) {
    console.error(error);
    return { success: false, message: error };
  }

  return data ?? { success: true };
}

export async function getProductCategoryOptions() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return { success: false as const, message: authorized.message, data: [] };
  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("product_category")
    .select("product_category_id, name")
    .eq("business", authorized.businessId)
    .order("name");
  if (error) return { success: false as const, message: error.message, data: [] };
  return { success: true as const, data: data ?? [] };
}

export async function getProductDeliveryMethodOptions() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) {
    return { success: false as const, message: authorized.message, data: [] };
  }

  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("delivery_methods_business")
    .select("uid, name")
    .eq("business_id", authorized.businessId)
    .order("name");

  if (error) {
    return { success: false as const, message: error.message, data: [] };
  }
  return { success: true as const, data: data ?? [] };
}

export async function createProductCategoryOption(name: string) {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const normalized = name.trim();
  if (!normalized) return { success: false as const, message: "El nombre es obligatorio." };
  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("product_category")
    .insert({ name: normalized, business: authorized.businessId })
    .select("product_category_id, name")
    .single();
  if (error || !data) return { success: false as const, message: error?.message ?? "No se pudo crear la categoría." };
  return { success: true as const, data };
}
