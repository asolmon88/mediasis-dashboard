import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export const SCHEDULES_MANAGE_PERMISSION = "ordering_app.schedules.manage.full";

export async function requireScheduleManagementAccess() {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) return { success: false as const, message: "No hay un negocio activo." };
  if (context.mode !== "legacy" && !hasDashboardPermission(context, SCHEDULES_MANAGE_PERMISSION)) {
    return { success: false as const, message: "No tenés permiso para administrar horarios." };
  }
  const admin = createAdminClient();
  const { data: business } = await admin.schema("mediasis").from("businesses")
    .select("uid, app_active").eq("uid", context.activeBusinessId).maybeSingle();
  if (!business?.uid || (context.mode !== "staff" && !business.app_active)) {
    return { success: false as const, message: "La app de pedidos no está activa para este negocio." };
  }
  if (context.mode === "clerk") {
    if (!context.appUserId) return { success: false as const, message: "No se pudo validar tu identidad." };
    const { data, error } = await admin.schema("mediasis").rpc("require_ordering_app_schedule_access", {
      p_business_id: context.activeBusinessId, p_actor_app_user_id: context.appUserId,
    });
    if (error || data !== true) return { success: false as const, message: "No tenés permiso para administrar horarios." };
  }
  return {
    success: true as const,
    context,
    admin,
    businessId: context.activeBusinessId,
    actorAppUserId: context.mode === "clerk" ? context.appUserId : null,
    canManageAllLocations: context.mode === "legacy" || context.allLocations,
    allowedLocationIds: new Set(context.locations.map((location) => location.business_location_id)),
  };
}

export function validateScheduleLocation(locationId: string, authorized: Awaited<ReturnType<typeof requireScheduleManagementAccess>>) {
  if (!authorized.success) return authorized;
  return authorized.canManageAllLocations || authorized.allowedLocationIds.has(locationId)
    ? { success: true as const }
    : { success: false as const, message: "No tenés acceso a esta ubicación." };
}
