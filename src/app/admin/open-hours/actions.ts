'use server'

import { OpenHoursSchema, type OpenHours } from "@/lib/FormSchemas/openHoursSchema";
import { buildWeekdayHours } from "@/lib/openHoursRows";
import { requireReservationsManagementAccess } from "@/lib/dashboard/reservation-authorization";

type RpcResult = { success?: boolean; message?: string; data?: unknown[]; count?: number };

async function call(name: string, args: Record<string, unknown>) {
  const access = await requireReservationsManagementAccess();
  if (!access.success) return access;
  const { data, error } = await access.admin.schema("mediasis").rpc(name, {
    p_business_id: access.businessId, p_actor_app_user_id: access.actorAppUserId, ...args,
  });
  const result = data as RpcResult | null;
  if (error || !result?.success) return { success: false as const, message: error?.message ?? result?.message ?? "No se pudo guardar el horario." };
  return { success: true as const, result };
}

export async function getReservationOpenHours(businessLocationId: string) {
  const response = await call("get_dashboard_reservation_open_hours", { p_location_id: businessLocationId });
  return response.success
    ? { success: true as const, rows: response.result.data ?? [] }
    : { ...response, rows: [] };
}

export async function upsertOpenHours({ values, business_location_id }: { values: OpenHours; business_location_id: string }) {
  const parsed = OpenHoursSchema.safeParse(values);
  if (!parsed.success) return { success: false, message: "Revisá el horario." };
  const response = await call("save_dashboard_reservation_open_hours", {
    p_location_ids: [business_location_id], p_weekdays: buildWeekdayHours(parsed.data),
  });
  return response.success ? { success: true, message: "Horario actualizado" } : response;
}

export async function applyOpenHoursToLocations({
  values, business_location_ids, applyToAll,
}: { values: OpenHours; business_location_ids: string[]; applyToAll: boolean; type?: 'reservation' }) {
  const parsed = OpenHoursSchema.safeParse(values);
  if (!parsed.success) return { success: false, message: "Revisá el horario." };
  const access = await requireReservationsManagementAccess();
  if (!access.success) return access;
  const locationIds = applyToAll ? access.eligibleLocationIds : Array.from(new Set(business_location_ids));
  const { data, error } = await access.admin.schema("mediasis").rpc("save_dashboard_reservation_open_hours", {
    p_business_id: access.businessId, p_actor_app_user_id: access.actorAppUserId,
    p_location_ids: locationIds, p_weekdays: buildWeekdayHours(parsed.data),
  });
  const result = data as RpcResult | null;
  if (error || !result?.success) return { success: false, message: error?.message ?? result?.message ?? "No se pudo aplicar el horario." };
  const count = result.count ?? locationIds.length;
  return { success: true, message: `Horario aplicado a ${count} ubicación${count === 1 ? '' : 'es'}` };
}
