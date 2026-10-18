"use server";

import { revalidatePath } from "next/cache";
import { requireMetaPixelManagementAccess } from "@/lib/dashboard/meta-pixel-authorization";
import { validatePixelId } from "@/lib/meta-pixel-connection";

export async function saveMetaPixelId(pixelIdInput: string) {
  const authorized = await requireMetaPixelManagementAccess();
  if (!authorized.success) return { success: false, message: authorized.message };

  let pixelId: string;
  try {
    pixelId = validatePixelId(pixelIdInput);
  } catch {
    return { success: false, message: "Ingresá un ID de pixel válido." };
  }

  const { data: current, error: readError } = await authorized.admin
    .schema("mediasis")
    .from("businesses")
    .select("meta_pixel_id_orders")
    .eq("uid", authorized.businessId)
    .maybeSingle();
  if (readError) return { success: false, message: "No se pudo guardar el pixel de Meta." };

  const update: { meta_pixel_id_orders: string; meta_token_orders?: null } = {
    meta_pixel_id_orders: pixelId,
  };
  // A server credential is scoped to a specific Pixel. Never retain one when
  // the merchant changes the ID; browser events only require the new ID.
  if (current?.meta_pixel_id_orders !== pixelId) update.meta_token_orders = null;

  const { error } = await authorized.admin
    .schema("mediasis")
    .from("businesses")
    .update(update)
    .eq("uid", authorized.businessId);
  if (error) return { success: false, message: "No se pudo guardar el pixel de Meta." };

  revalidatePath("/admin/marketing/facebook-pixel");
  return {
    success: true,
    message: "Pixel guardado. Los eventos del navegador ya están activos.",
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
