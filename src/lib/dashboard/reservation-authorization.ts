import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export const RESERVATIONS_MANAGE_PERMISSION = "reservations.manage.full";

export async function requireReservationsManagementAccess() {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) return { success: false as const, message: "No hay un negocio activo." };
  if (context.mode !== "legacy" && !hasDashboardPermission(context, RESERVATIONS_MANAGE_PERMISSION)) {
    return { success: false as const, message: "No tenés permiso para administrar reservaciones." };
  }
  const admin = createAdminClient();
  if (context.mode === "clerk") {
    if (!context.appUserId) return { success: false as const, message: "No se pudo validar tu identidad." };
    const { data, error } = await admin.schema("mediasis").rpc("require_reservations_management_access", {
      p_business_id: context.activeBusinessId,
      p_actor_app_user_id: context.appUserId,
    });
    if (error || data !== true) return { success: false as const, message: "No tenés permiso para administrar reservaciones." };
  }
  return {
    success: true as const,
    context,
    admin,
    businessId: context.activeBusinessId,
    actorAppUserId: context.mode === "clerk" ? context.appUserId : null,
    eligibleLocationIds: context.reservationLocationIds,
    eligibleLocations: context.locations.filter((location) =>
      context.reservationLocationIds.includes(location.business_location_id)
    ),
  };
}
