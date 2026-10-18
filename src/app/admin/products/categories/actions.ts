"use server";

import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";
import { ProductCategoryTableRow } from "@/lib/types/dashboardTypes";

export async function getCurrentBusinessCategories() {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;

  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("product_category")
    .select("product_category_id, name, visible, sequence, parent_category_id")
    .eq("business", authorized.businessId)
    .order("name");

  if (error) {
    console.error(error);
    return { success: false, message: error };
  }

  const categoryIds = (data ?? []).map((row) => row.product_category_id);
  const { data: productLinks, error: linksError } = categoryIds.length
    ? await authorized.admin.schema("mediasis").from("product_category_product")
        .select("product_category_id").in("product_category_id", categoryIds)
    : { data: [], error: null };
  if (linksError) return { success: false, message: linksError };
  const categoriesWithProducts = new Set((productLinks ?? []).map((row) => row.product_category_id));
  const rows = (data ?? []).map((row) => ({
    ...row,
    has_products: categoriesWithProducts.has(row.product_category_id),
  })) as ProductCategoryTableRow;
  const hasSequence = rows.some((row) => row.sequence > 0);

  const sorted = [...rows].sort((a, b) => {
    if (!hasSequence) {
      return a.name.localeCompare(b.name);
    }

    const aZero = a.sequence === 0;
    const bZero = b.sequence === 0;
    if (aZero !== bZero) {
      return aZero ? 1 : -1;
    }

    if (a.sequence !== b.sequence) {
      return a.sequence - b.sequence;
    }

    return a.name.localeCompare(b.name);
  });

  return { success: true, data: sorted };
}

export async function updateCategoryHierarchy(items: {
  id: string;
  parent_id: string | null;
  sequence: number;
}[]) {
  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const { error } = await authorized.admin.schema("mediasis").rpc("save_category_hierarchy", {
    p_business_id: authorized.businessId,
    p_items: items,
  });
  if (error) {
    console.error(error);
    return { success: false, message: error.message };
  }
  return { success: true };
}
