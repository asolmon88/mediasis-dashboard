'use server'

import { ProductEditInput, ProductEditSchema } from "@/lib/FormSchemas/productEditSchema";
import { buildProductDiff } from "@/lib/products/build-product-diff";
import { parseStorageUrl } from "@/lib/utils";
import {
  mergeProtectedProductLocationScope,
  requireProductAccess,
  validateLocationSelection,
} from "@/lib/dashboard/product-authorization";

type ExistingProductRecord = ProductEditInput & {
  category?: ProductEditInput["categories"];
};

export async function updateProduct(productId: string, values: ProductEditInput) {
  const parsed = ProductEditSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, message: parsed.error };
  }

  if (!productId) {
    return { success: false, message: "Missing product identifier" };
  }

  const authorized = await requireProductAccess(productId);
  if (!authorized.success) return authorized;
  const submittedLocations = [
    ...(parsed.data.business_locations ?? []).map((location) => location.value),
    ...(parsed.data.variants ?? []).flatMap((variant) =>
      (variant.business_locations ?? []).map((location) => location.value),
    ),
    ...(parsed.data.options ?? []).flatMap((option) =>
      (option.choices ?? []).flatMap((choice) => choice.location_ids ?? []),
    ),
  ];
  const locationValidation = validateLocationSelection(submittedLocations, authorized);
  if (!locationValidation.success) return locationValidation;

  const supabase = authorized.admin;
  try {
    const { data, error } = await supabase
      .schema("mediasis")
      .rpc("get_product_for_edit_authoritative", { p_product_id: productId });

    if (error) {
      console.error(error);
      return { success: false, message: error };
    }

    const existingProductRecord = (Array.isArray(data) ? data[0] : data) as
      | ExistingProductRecord
      | null;

    if (!existingProductRecord) {
      return { success: false, message: "Producto no encontrado" };
    }

    const normalizedExistingProduct = normalizeLegacyProduct(existingProductRecord);
    const desiredProduct = authorized.canManageAllLocations
      ? parsed.data
      : mergeProtectedProductLocationScope(
          normalizedExistingProduct,
          parsed.data,
          authorized.allowedLocationIds,
        );

    const diff = buildProductDiff(
      { ...normalizedExistingProduct, product_id: productId },
      desiredProduct,
    );
    
    const editResult = await supabase.schema("mediasis").rpc("update_product_for_dashboard", {
      p_business_id: authorized.businessId,
      p_diff: diff,
    });
    if (!editResult.data || editResult.error) {
      throw editResult.error;
    }
    return editResult.data
  } catch (error) {
    return { success: false, message: error };
  }
}

type DeleteProductPayload = {
  images?: string[] | undefined;
  variants?: { images?: string[] | undefined }[] | undefined;
};

export async function deleteProduct(productId: string, product: DeleteProductPayload) {
  if (!productId) {
    return { success: false, message: "Missing product identifier" };
  }

  const authorized = await requireProductAccess(productId);
  if (!authorized.success) return authorized;
  const supabase = authorized.admin;
  try {
    const allImages = [
      ...(product.images ?? []),
      ...(product.variants ?? []).flatMap((variant) => variant.images ?? []),
    ];

    const grouped = allImages.reduce<Record<string, string[]>>((acc, url) => {
      const parsed = parseStorageUrl(url);
      if (!parsed) return acc;
      if (!acc[parsed.bucket]) {
        acc[parsed.bucket] = [];
      }
      acc[parsed.bucket].push(parsed.path);
      return acc;
    }, {});

    for (const [bucket, paths] of Object.entries(grouped)) {
      if (paths.length === 0) continue;
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) {
        console.error(error);
        return { success: false, message: error };
      }
    }

    const { error } = await supabase
      .schema("mediasis")
      .from("product")
      .delete()
      .eq("product_id", productId)
      .eq("business", authorized.businessId);
    if (error) {
      console.error(error);
      return { success: false, message: error };
    }

    return { success: true, message: "Product deleted successfully" };
  } catch (error) {
    return { success: false, message: error };
  }
}

function normalizeLegacyProduct(record: ExistingProductRecord): ProductEditInput {
  const normalizedCategories =
    (record.categories && record.categories.length > 0
      ? record.categories
      : record.category) ?? [];

  return {
    ...record,
    categories: normalizedCategories,
  };
}
