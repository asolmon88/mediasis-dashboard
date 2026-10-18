"use server";
import { OpenHoursSchema, type OpenHours } from "@/lib/FormSchemas/openHoursSchema";
import { requireScheduleManagementAccess, validateScheduleLocation } from "@/lib/dashboard/schedule-authorization";
import { buildWeekdayHours } from "@/lib/openHoursRows";
import z from "zod";
type RpcResult = { success?: boolean; message?: string; count?: number };

export async function getOrderingOpenHours(businessLocationId: string) {
  const authorized = await requireScheduleManagementAccess();
  if (!authorized.success) return { ...authorized, rows: [] };
  const access = validateScheduleLocation(businessLocationId, authorized);
  if (!access.success) return { ...access, rows: [] };
  const { data, error } = await authorized.admin.schema("mediasis").rpc("get_ordering_app_open_hours", {
    p_business_id: authorized.businessId, p_actor_app_user_id: authorized.actorAppUserId, p_location_id: businessLocationId,
  });
  return error ? { success: false, message: "No se pudo cargar el horario.", rows: [] }
    : { success: true, rows: (data ?? []) as Array<{ weekday: number; hours: Array<{ start: number; end: number }> }> };
}

export async function upsertOpenHours({ values, business_location_id }: { values: OpenHours; business_location_id: string }) {
  return saveToLocations(values, [business_location_id]);
}

async function saveToLocations(values: OpenHours, locationIds: string[]) {
  const parsed = OpenHoursSchema.safeParse(values);
  if (!parsed.success) return { success: false, message: z.prettifyError(parsed.error) };
  const authorized = await requireScheduleManagementAccess();
  if (!authorized.success) return authorized;
  if (!locationIds.length || locationIds.some((id) => !validateScheduleLocation(id, authorized).success)) {
    return { success: false, message: "No tenés acceso a una de las ubicaciones seleccionadas." };
  }
  const { data, error } = await authorized.admin.schema("mediasis").rpc("save_ordering_app_open_hours", {
    p_business_id: authorized.businessId, p_actor_app_user_id: authorized.actorAppUserId,
    p_location_ids: Array.from(new Set(locationIds)), p_weekdays: buildWeekdayHours(parsed.data),
  });
  const result = data as RpcResult | null;
  return error || !result?.success ? { success: false, message: error?.message ?? result?.message ?? "No se pudo guardar el horario." }
    : { success: true, message: "Horario actualizado", count: result.count ?? locationIds.length };
}

export async function applyOrderingOpenHoursToLocations(input: { values: OpenHours; business_location_ids: string[]; applyToAll: boolean }) {
  const authorized = await requireScheduleManagementAccess();
  if (!authorized.success) return authorized;
  if (input.applyToAll && !authorized.canManageAllLocations) {
    return { success: false, message: "Necesitás acceso a todas las ubicaciones para usar esta opción." };
  }
  const targets = input.applyToAll ? authorized.context.locations.map((location) => location.business_location_id) : input.business_location_ids;
  const result = await saveToLocations(input.values, targets);
  return result.success ? { ...result, message: `Horario aplicado a ${result.count} ubicación${result.count === 1 ? "" : "es"}` } : result;
}
