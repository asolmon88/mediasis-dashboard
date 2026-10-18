'use server'

import { CheckoutInput, CheckoutSchema } from "@/lib/FormSchemas/checkoutSchema";
import { StartCardsInput, StartCardsSchema } from "@/lib/FormSchemas/startCardsSchema"
import { StoreAppearanceInput, StoreAppearanceSchema } from "@/lib/FormSchemas/StoreAppearanceSchema";
import { parseStorageUrl } from "@/lib/utils";
import {
  getVisiblePaymentMethodCountForLocation,
  requireStorefrontManagementAccess,
  validateStorefrontLocation,
} from "@/lib/dashboard/storefront-authorization";

function storageUrlBelongsToBusiness(url: string | undefined, businessId: string) {
  if (!url) return true;
  const parsed = parseStorageUrl(url);
  return !parsed || (parsed.bucket === "app_metadata" && parsed.path.startsWith(`${businessId}/`));
}

export async function getStartCardsData() {
  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) return { success: false as const, message: authorized.message, data: null };
  const { data, error } = await authorized.admin.schema("mediasis").rpc("storefront_start_cards_json", {
    p_business_id: authorized.businessId,
  });
  return error
    ? { success: false as const, message: error.message, data: null }
    : { success: true as const, data: data ?? null };
}

export async function getAppearanceData() {
  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) return { success: false as const, message: authorized.message, data: null };
  const { data, error } = await authorized.admin.schema("mediasis").rpc("storefront_appearance_json", {
    p_business_id: authorized.businessId,
  });
  if (error) return { success: false as const, message: error.message, data: null };
  return { success: true as const, data: data ?? null };
}

export async function getStartCardCategories() {
  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) return { success: false as const, message: authorized.message, data: [] };
  const { data, error } = await authorized.admin.schema("mediasis")
    .rpc("get_eligible_storefront_categories", { p_business_id: authorized.businessId });
  return error ? { success: false as const, message: error.message, data: [] } : { success: true as const, data: data ?? [] };
}

export async function upsertStartCardsData({
  startCardsData,
} : {
  startCardsData: StartCardsInput
}) {
  const parsed = StartCardsSchema.safeParse(startCardsData);
  if (parsed.error) {
    return {success: false, message: `Error al procesar los datos ingresados: ${JSON.stringify(parsed.error,null,2)}`}
  }

  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) return authorized;

  const categoryIds = parsed.data
    .filter((card) => card.type === "product_category")
    .map((card) => card.category.value);
  if (categoryIds.length) {
    const { data: eligibleCategories, error: categoryError } = await authorized.admin.schema("mediasis")
      .rpc("get_eligible_storefront_categories", { p_business_id: authorized.businessId });
    const eligibleIds = new Set(
      (eligibleCategories ?? []).map((category: { product_category_id: string }) => category.product_category_id),
    );
    if (categoryError || categoryIds.some((categoryId) => !eligibleIds.has(categoryId))) {
      return { success: false, message: "Una categoría seleccionada ya no tiene productos visibles o no está disponible." };
    }
    if (new Set(categoryIds).size !== categoryIds.length) {
      return { success: false, message: "Una categoría no puede aparecer en más de una tarjeta." };
    }
  }
  const submittedImages = parsed.data.filter((card) => card.type === "image").flatMap((card) => card.links_to_image);
  if (authorized.context.mode !== "legacy" && submittedImages.some((url) => !storageUrlBelongsToBusiness(url, authorized.businessId))) {
    return { success: false, message: "Una imagen seleccionada no pertenece al negocio." };
  }

  const imagesToDelete = await getStartCardsImagesToDelete(parsed.data);
  const imageDeleteResult = await deleteStorageImagesByUrl(imagesToDelete, authorized.businessId);
  if (!imageDeleteResult.success) {
    return { success: false, message: `Error al eliminar las imágenes: ${JSON.stringify(imageDeleteResult.error, null, 2)}` }
  }

  const { error } = await authorized.admin.schema('mediasis').rpc('save_storefront_start_cards', {
    p_business_id: authorized.businessId,
    p_payload: parsed.data,
  });

  if (error) return { success: false, message: `Error al procesar los datos ingresados: ${JSON.stringify(error, null, 2)}` }

  return {success: true, message: 'Actualizado/insertado con éxito.'}
}

function diffArray<T extends string>(prev: T[], next: T[]) {
  const nextSet = new Set(next);
  return prev.filter((item) => !nextSet.has(item));
}

export async function getStartCardsImagesToDelete(newStartCards: StartCardsInput) {
  const result = await getStartCardsData();
  const data = result.data;
  if (!result.success || !data) return [];

  const parsed = StartCardsSchema.safeParse(data);
  if (!parsed.success) return [];

  const dbImageLinks = parsed.data
    .filter((card) => card.type === "image")
    .flatMap((card) => card.links_to_image);

  const newImageLinks = newStartCards
    .filter((card) => card.type === "image")
    .flatMap((card) => card.links_to_image);

  return diffArray(dbImageLinks, newImageLinks);
}

export async function getAppearanceImagesToDelete(newAppearance: StoreAppearanceInput) {
  const result = await getAppearanceData();
  const data = result.data;
  if (!result.success || !data) return [];

  const parsed = StoreAppearanceSchema.safeParse(data);
  if (!parsed.success) return [];

  const toDelete: string[] = [];

  if (parsed.data.logo && parsed.data.logo !== newAppearance.logo) {
    toDelete.push(parsed.data.logo);
  }

  if (parsed.data.front_page_image && parsed.data.front_page_image !== newAppearance.front_page_image) {
    toDelete.push(parsed.data.front_page_image);
  }

  return toDelete;
}

async function deleteStorageImagesByUrl(urls: string[], businessId: string) {
  if (urls.length === 0) return { success: true as const };

  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success || authorized.businessId !== businessId) return { success: false as const, error: "Unauthorized" };
  const grouped = urls.reduce<Record<string, string[]>>((acc, url) => {
    const parsed = parseStorageUrl(url);
    if (!parsed || parsed.bucket !== "app_metadata" || !parsed.path.startsWith(`${businessId}/`)) return acc;
    if (!acc[parsed.bucket]) acc[parsed.bucket] = [];
    acc[parsed.bucket].push(parsed.path);
    return acc;
  }, {});

  for (const [bucket, paths] of Object.entries(grouped)) {
    if (paths.length === 0) continue;
    const { error } = await authorized.admin.storage.from(bucket).remove(paths);
    if (error) return { success: false as const, error };
  }

  return { success: true as const };
}

export async function upsertCheckoutData({
  checkoutData,
  businessLocationId,
} : {
  checkoutData: CheckoutInput,
  businessLocationId: string,
}) {
  const parsed = CheckoutSchema.safeParse(checkoutData);
  if (parsed.error) {
    return {success: false, message: `Error al procesar los datos ingresados: ${JSON.stringify(parsed.error,null,2)}`}
  }

  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) return authorized;
  const locationAccess = validateStorefrontLocation(businessLocationId, authorized);
  if (!locationAccess.success) return locationAccess;

  const { data: location, error: locationError } = await authorized.admin
    .schema('mediasis')
    .from('business_location')
    .select('business_location_id')
    .eq('business_location_id', businessLocationId)
    .eq('business_uid', authorized.businessId)
    .maybeSingle()

  if (locationError || !location) {
    return { success: false, message: 'La ubicación activa no pertenece al negocio.' }
  }

  if (parsed.data.customer_sends_whatsapp_manually) {
    const paymentMethodsResult = await getVisiblePaymentMethodCountForLocation(authorized, businessLocationId);
    if (!paymentMethodsResult.success) {
      return {
        success: false,
        message: paymentMethodsResult.message,
      }
    }

    if (paymentMethodsResult.count > 0) {
      return {
        success: false,
        message: 'El envío manual por WhatsApp solo está disponible en ubicaciones sin métodos de pago habilitados.',
      }
    }
  }

  const { data, error } = await authorized.admin.schema('mediasis').rpc('save_storefront_checkout_data', {
    p_business_id: authorized.businessId,
    p_business_location_id: businessLocationId,
    p_payload: parsed.data,
    p_manual_whatsapp: parsed.data.customer_sends_whatsapp_manually ?? false,
  });
  if (error || !data?.success) return { success: false, message: error?.message ?? data?.message ?? "No se pudo guardar la configuración." }

  return {success: true, message: 'Actualizado/insertado con éxito.'}
}

export async function upsertAppearanceData({
  appearanceData
} : {
  appearanceData: StoreAppearanceInput
}) {
  const parsed = StoreAppearanceSchema.safeParse(appearanceData);
  if (parsed.error) {
    return {success: false, message: `Error al procesar los datos ingresados: ${JSON.stringify(parsed.error,null,2)}`}
  }

  const {
    name,
    description,
    primary_color,
    background_color,
    ...appearance_data
  } = parsed.data

  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) return authorized;
  if (authorized.context.mode !== "legacy" && [parsed.data.logo, parsed.data.front_page_image]
    .some((url) => !storageUrlBelongsToBusiness(url, authorized.businessId))) {
    return { success: false, message: "Una imagen seleccionada no pertenece al negocio." };
  }

  const imagesToDelete = await getAppearanceImagesToDelete(parsed.data)
  const imageDeleteResult = await deleteStorageImagesByUrl(imagesToDelete, authorized.businessId);
  if (!imageDeleteResult.success) {
    return { success: false, message: `Error al eliminar las imágenes: ${JSON.stringify(imageDeleteResult.error, null, 2)}` }
  }

  const { error } = await authorized.admin.schema('mediasis').rpc('save_storefront_appearance', {
    p_business_id: authorized.businessId,
    p_payload: { name, description, primary_color, background_color, ...appearance_data },
  });

  if (error) return { success: false, message: `Error al procesar los datos ingresados: ${JSON.stringify(error,null,2)}` }

  return {success: true, message: 'Actualizado/insertado con éxito.'}
}
