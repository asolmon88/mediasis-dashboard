"use server";

import { CategoryAddInput, CategoryAddSchema } from "@/lib/FormSchemas/categorySchema";
import { requireFullProductsAccess } from "@/lib/dashboard/product-authorization";

type StoragePath = { bucket: string; path: string };

function parseStorageUrl(url: string): StoragePath | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/,
    );
    if (!match) return null;
    return { bucket: match[1], path: match[2] };
  } catch {
    return null;
  }
}

export async function updateCategory(categoryId: string, values: CategoryAddInput) {
  const parsed = CategoryAddSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, message: parsed.error };
  }

  if (!categoryId) {
    return { success: false, message: "Categoria invalida" };
  }

  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const supabase = authorized.admin;

  const { data: existingCategory, error: existingError } = await supabase
    .schema("mediasis")
    .from("product_category")
    .select("image_url")
    .eq("product_category_id", categoryId)
    .eq("business", authorized.businessId)
    .single();

  if (existingError) {
    console.error(existingError);
    return { success: false, message: existingError };
  }

  const { count: childCount, error: childError } = await supabase.schema("mediasis")
    .from("product_category").select("product_category_id", { count: "exact", head: true })
    .eq("business", authorized.businessId).eq("parent_category_id", categoryId);
  if (childError) return { success: false, message: childError };
  if ((childCount ?? 0) > 0 && (!parsed.data.visible || (parsed.data.products ?? []).length > 0)) {
    return { success: false, message: "Mové las subcategorías antes de ocultar esta categoría o asignarle productos." };
  }
  const existingImage = existingCategory?.image_url ?? null;
  const nextImage = parsed.data.image_url ?? null;

  if (existingImage && existingImage !== nextImage) {
    const parsedPath = parseStorageUrl(existingImage);
    if (parsedPath) {
      const { error: deleteError } = await supabase.storage
        .from(parsedPath.bucket)
        .remove([parsedPath.path]);
      if (deleteError) {
        console.error(deleteError);
        return { success: false, message: deleteError };
      }
    }
  }

  const products = parsed.data.products ?? [];
  if (products.length > 0) {
    const productIds = products.map((product) => product.product_id);
    const { data: ownedProducts, error: productsError } = await supabase.schema("mediasis").from("product")
      .select("product_id").eq("business", authorized.businessId).in("product_id", productIds);
    if (productsError || (ownedProducts ?? []).length !== new Set(productIds).size) {
      return { success: false, message: "Uno de los productos no pertenece al negocio." };
    }
  }

  const { error: saveError } = await supabase.schema("mediasis").rpc("save_product_category_for_dashboard", {
    p_business_id: authorized.businessId,
    p_category_id: categoryId,
    p_name: parsed.data.name,
    p_visible: parsed.data.visible,
    p_image_url: nextImage,
    p_products: products,
  });
  if (saveError) {
    console.error(saveError);
    return { success: false, message: saveError };
  }

  return { success: true };
}

export async function deleteCategory(categoryId: string) {
  if (!categoryId) {
    return { success: false, message: "Categoria invalida" };
  }

  const authorized = await requireFullProductsAccess();
  if (!authorized.success) return authorized;
  const supabase = authorized.admin;

  const { data: existingCategory, error: existingError } = await supabase
    .schema("mediasis")
    .from("product_category")
    .select("image_url")
    .eq("product_category_id", categoryId)
    .eq("business", authorized.businessId)
    .single();

  if (existingError) {
    console.error(existingError);
    return { success: false, message: existingError };
  }

  const { count: childCount, error: childError } = await supabase.schema("mediasis")
    .from("product_category").select("product_category_id", { count: "exact", head: true })
    .eq("business", authorized.businessId).eq("parent_category_id", categoryId);
  if (childError) return { success: false, message: childError };
  if ((childCount ?? 0) > 0) {
    return { success: false, message: "Mové las subcategorías antes de eliminar esta categoría." };
  }
  const existingImage = existingCategory?.image_url ?? null;
  if (existingImage) {
    const parsedPath = parseStorageUrl(existingImage);
    if (parsedPath) {
      const { error: deleteError } = await supabase.storage
        .from(parsedPath.bucket)
        .remove([parsedPath.path]);
      if (deleteError) {
        console.error(deleteError);
        return { success: false, message: deleteError };
      }
    }
  }

  const { error: deleteCategoryError } = await supabase
    .schema("mediasis")
    .from("product_category")
    .delete()
    .eq("product_category_id", categoryId)
    .eq("business", authorized.businessId);

  if (deleteCategoryError) {
    console.error(deleteCategoryError);
    return { success: false, message: deleteCategoryError };
  }

  return { success: true };
}
