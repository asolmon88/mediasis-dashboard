"use server";

import { revalidatePath } from "next/cache";
import { requireMetaPixelManagementAccess } from "@/lib/dashboard/meta-pixel-authorization";
import { buildMetaPixelUpdate, validateMetaPixelId } from "@/lib/meta-pixel-settings";

export async function getMetaPixelToken() {
  const authorized = await requireMetaPixelManagementAccess();
  if (!authorized.success) return { success: false as const, message: authorized.message };

  const { data, error } = await authorized.admin
    .schema("mediasis")
    .from("businesses")
    .select("meta_token_orders")
    .eq("uid", authorized.businessId)
    .maybeSingle();

  if (error) return { success: false as const, message: "No se pudo mostrar el token de Meta." };
  if (!data?.meta_token_orders) return { success: false as const, message: "No hay un token de Meta guardado." };

  return { success: true as const, token: data.meta_token_orders };
}

export async function saveMetaPixelSettings(pixelIdInput: string, tokenInput: string | null) {
  const authorized = await requireMetaPixelManagementAccess();
  if (!authorized.success) return { success: false, message: authorized.message };

  let pixelId: string;
  try {
    pixelId = validateMetaPixelId(pixelIdInput);
  } catch {
    return { success: false, message: "Ingresá un ID de pixel válido." };
  }

  const { data: current, error: readError } = await authorized.admin
    .schema("mediasis")
    .from("businesses")
    .select("meta_pixel_id_orders, meta_token_orders")
    .eq("uid", authorized.businessId)
    .maybeSingle();
  if (readError) return { success: false, message: "No se pudo guardar la configuración de Meta." };

  let update: { meta_pixel_id_orders: string; meta_token_orders?: string };
  try {
    update = buildMetaPixelUpdate(current, pixelId, tokenInput);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "token-required-for-pixel-change") {
      return { success: false, message: "Al cambiar el ID del pixel, ingresá también el token correspondiente." };
    }
    return { success: false, message: "Ingresá un token válido de la API de conversiones." };
  }

  const { error } = await authorized.admin
    .schema("mediasis")
    .from("businesses")
    .update(update)
    .eq("uid", authorized.businessId);
  if (error) return { success: false, message: "No se pudo guardar la configuración de Meta." };

  revalidatePath("/admin/marketing/facebook-pixel");
  return {
    success: true,
    message: "El ID del pixel y el token de Meta se guardaron correctamente.",
  };
}

export async function disconnectMetaPixel() {
  const authorized = await requireMetaPixelManagementAccess();
  if (!authorized.success) return { success: false, message: authorized.message };
  const { error } = await authorized.admin.schema("mediasis").from("businesses").update({
    meta_pixel_id_orders: null,
    meta_token_orders: null,
  }).eq("uid", authorized.businessId);
  if (error) return { success: false, message: "No se pudo desconectar Facebook pixel." };
  revalidatePath("/admin/marketing/facebook-pixel");
  return { success: true, message: "Facebook pixel se desconectó." };
}
