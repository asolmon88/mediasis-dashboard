"use server";

import { CategoryAddInput, CategoryAddSchema } from "@/lib/FormSchemas/categorySchema";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";

type CategoryInsertResult = {
  product_category_id: string;
};

export async function addCategory(values: CategoryAddInput) {
  const parsed = CategoryAddSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, message: parsed.error };
  }

  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;

  const { data: sequenceRows, error: sequenceError } = await authorized.admin
    .schema("mediasis")
    .from("product_category")
    .select("sequence")
    .eq("business", authorized.businessId)
    .order("sequence", { ascending: false })
    .limit(1);

  if (sequenceError) {
    console.error(sequenceError);
    return { success: false, message: sequenceError };
  }

  const nextSequence = (sequenceRows?.[0]?.sequence ?? 0) + 1;

  const { data: category, error: categoryError } = await authorized.admin
    .schema("mediasis")
    .from("product_category")
    .insert({
      name: parsed.data.name,
      visible: parsed.data.visible,
      image_url: parsed.data.image_url ?? null,
      business: authorized.businessId,
      sequence: nextSequence,
    })
    .select("product_category_id")
    .single();

  if (categoryError || !category?.product_category_id) {
    console.error(categoryError);
    return { success: false, message: categoryError ?? "Error al crear categoria" };
  }

  const products = parsed.data.products ?? [];
  if (products.length > 0) {
    const productIds = products.map((product) => product.product_id);
    const { data: ownedProducts } = await authorized.admin.schema("mediasis").from("product")
      .select("product_id").eq("business", authorized.businessId).in("product_id", productIds);
    if ((ownedProducts ?? []).length !== new Set(productIds).size) {
      return { success: false, message: "Uno de los productos no pertenece al negocio." };
    }
    const rows = products.map((product) => ({
      product_category_id: category.product_category_id,
      product_id: product.product_id,
      sequence: product.sequence,
    }));

    const { error: productsError } = await authorized.admin
      .schema("mediasis")
      .from("product_category_product")
      .insert(rows);

    if (productsError) {
      console.error(productsError);
      return { success: false, message: productsError };
    }
  }

  return { success: true, data: category as CategoryInsertResult };
}
