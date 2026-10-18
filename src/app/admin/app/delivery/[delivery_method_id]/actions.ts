"use server";

import { DeliverySchema, type DeliveryInput } from "@/lib/FormSchemas/deliverySchema";
import { requireDeliveryManagementAccess } from "@/lib/dashboard/delivery-authorization";

type UpsertArgs = { data: DeliveryInput; recordId?: string };
type RpcResult = { success?: boolean; message?: string; record_id?: string };

export async function upsertDeliveryMethod({ data, recordId }: UpsertArgs) {
  const parsed = DeliverySchema.safeParse(data);
  if (!parsed.success) return { success: false, message: "Revisá los datos del método de delivery." };
  const authorized = await requireDeliveryManagementAccess();
  if (!authorized.success) return authorized;

  if (!authorized.canManageAllLocations && !recordId && (parsed.data.business_location_id ?? []).length === 0) {
    return { success: false, message: "Seleccioná al menos una ubicación permitida." };
  }

  // Courier dispatch always needs an address. Disabling courier deliberately
  // leaves the location setting untouched so a location-only method remains
  // possible.
  const payload = {
    ...parsed.data,
    require_location: parsed.data.require_location || parsed.data.require_courier,
  };

  const { data: result, error } = await authorized.admin.schema("mediasis").rpc("save_ordering_app_delivery_method", {
    p_business_id: authorized.businessId,
    p_actor_app_user_id: authorized.actorAppUserId,
    p_record_id: recordId ?? null,
    p_payload: payload,
  });
  const response = result as RpcResult | null;
  if (error || !response?.success) {
    return { success: false, message: error?.message ?? response?.message ?? "No se pudo guardar el método de delivery." };
  }
  return { success: true, recordId: response.record_id };
}
