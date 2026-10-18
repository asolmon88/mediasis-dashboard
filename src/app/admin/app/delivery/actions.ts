"use server";

import { requireDeliveryManagementAccess, validateDeliveryLocation } from "@/lib/dashboard/delivery-authorization";
import { minutesToIntervalLiteral } from "@/lib/utils";

type OffsetArgs = { business_delivery_method_id: string; business_location_id: string; pickup_ready_offset_minutes: number };
type GetArgs = { business_location_id: string; delivery_method_ids: string[] };

export async function updateDeliveryPickupReadyOffsetByLocation(input: OffsetArgs) {
  const minutes = Number.isFinite(input.pickup_ready_offset_minutes)
    ? Math.max(1, Math.min(180, Math.round(input.pickup_ready_offset_minutes))) : NaN;
  if (!input.business_delivery_method_id || !input.business_location_id || Number.isNaN(minutes)) {
    return { success: false, message: "Datos inválidos para actualizar el tiempo de preparación." };
  }
  const authorized = await requireDeliveryManagementAccess();
  if (!authorized.success) return authorized;
  const locationAccess = validateDeliveryLocation(input.business_location_id, authorized);
  if (!locationAccess.success) return locationAccess;
  const { data: method } = await authorized.admin.schema("mediasis").from("delivery_methods_business")
    .select("uid").eq("uid", input.business_delivery_method_id).eq("business_id", authorized.businessId).maybeSingle();
  if (!method) return { success: false, message: "No tenés permiso para editar este método de delivery." };
  const { error } = await authorized.admin.schema("mediasis").from("delivery_method_business_pickup_offset_location")
    .upsert({ business_delivery_method_id: input.business_delivery_method_id, business_location_id: input.business_location_id,
      pickup_ready_offset: minutesToIntervalLiteral(minutes) },
      { onConflict: "business_delivery_method_id,business_location_id" });
  return error ? { success: false, message: "No se pudo actualizar el tiempo de preparación." }
    : { success: true, pickup_ready_offset_minutes: minutes };
}

export async function getDeliveryPickupOffsetsByLocation(input: GetArgs) {
  const authorized = await requireDeliveryManagementAccess();
  const empty = {} as Record<string, string | null>;
  if (!authorized.success) return { ...authorized, offsets: empty };
  if (!input.business_location_id) return { success: true, offsets: empty };
  const locationAccess = validateDeliveryLocation(input.business_location_id, authorized);
  if (!locationAccess.success) return { ...locationAccess, offsets: empty };
  const requested = Array.from(new Set((input.delivery_method_ids ?? []).filter(Boolean)));
  if (!requested.length) return { success: true, offsets: empty };
  const { data: methods, error: methodError } = await authorized.admin.schema("mediasis").from("delivery_methods_business")
    .select("uid").eq("business_id", authorized.businessId).in("uid", requested);
  if (methodError) return { success: false, message: "No se pudieron validar los métodos de delivery.", offsets: empty };
  const ids = (methods ?? []).map((row) => row.uid);
  if (!ids.length) return { success: true, offsets: empty };
  const { data, error } = await authorized.admin.schema("mediasis").from("delivery_method_business_pickup_offset_location")
    .select("business_delivery_method_id, pickup_ready_offset").eq("business_location_id", input.business_location_id)
    .in("business_delivery_method_id", ids);
  if (error) return { success: false, message: "No se pudieron cargar los tiempos de preparación.", offsets: empty };
  const offsets = (data ?? []).reduce<Record<string, string | null>>((acc, row) => {
    acc[row.business_delivery_method_id] = row.pickup_ready_offset as string | null;
    return acc;
  }, {});
  return { success: true, offsets };
}
