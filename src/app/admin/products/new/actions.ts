'use server'

import { ProductAddInput, ProductAddSchema } from "@/lib/FormSchemas/productAddSchema";
import { requireFullProductsAccess, validateLocationSelection } from "@/lib/dashboard/product-authorization";
import z from "zod";

export async function addNewProduct(values: z.infer<ProductAddInput>) {
  const parsed = ProductAddSchema.safeParse(values);
  if (parsed.success) {
    const authorized = await requireFullProductsAccess();
    if (!authorized.success) return authorized;
    const locationIds = (parsed.data.business_locations ?? []).map((location) => location.value);
    const locationValidation = validateLocationSelection(locationIds, authorized);
    if (!locationValidation.success) return locationValidation;
    if (!authorized.canManageAllLocations && locationIds.length === 0) {
      return { success: false, message: "Seleccioná al menos una ubicación permitida." };
    }
    try {
      const result = await authorized.admin.schema("mediasis").rpc("add_product_for_dashboard", {
        p_business_id: authorized.businessId,
        p_product_data: parsed.data,
      });
      if (result.error) return { success: false, message: result.error.message };
      return result.data;
    } catch (error) {
      console.log(error);
      return { success: false,  message: error }
    }
  }
  return { success: false,  message: parsed.error }
}
