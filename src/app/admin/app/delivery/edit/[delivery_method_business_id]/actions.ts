"use server";

import { requireDeliveryManagementAccess } from "@/lib/dashboard/delivery-authorization";

export async function deleteDeliveryMethod(uid: string) {
  if (!uid) return { success: false, message: "Método de delivery inválido." };
  const authorized = await requireDeliveryManagementAccess();
  if (!authorized.success) return authorized;
  if (!authorized.canManageAllLocations) {
    return { success: false, message: "Necesitás acceso a todas las ubicaciones para borrar este método." };
  }
  const { data, error } = await authorized.admin.schema("mediasis").rpc("delete_ordering_app_delivery_method", {
    p_business_id: authorized.businessId,
    p_actor_app_user_id: authorized.actorAppUserId,
    p_record_id: uid,
  });
  const result = data as { success?: boolean; message?: string } | null;
  return error || !result?.success
    ? { success: false, message: error?.message ?? result?.message ?? "No se pudo borrar el método." }
    : { success: true };
}
