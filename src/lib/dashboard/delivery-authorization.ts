import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusinessPlanEntitlements } from "@/lib/dashboard/plan-entitlements";

export const DELIVERY_MANAGE_PERMISSION = "ordering_app.delivery.manage.full";

export async function requireDeliveryManagementAccess() {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) {
    return { success: false as const, message: "No hay un negocio activo." };
  }
  if (context.mode !== "legacy" && !hasDashboardPermission(context, DELIVERY_MANAGE_PERMISSION)) {
    return { success: false as const, message: "No tenés permiso para administrar delivery." };
  }

  const admin = createAdminClient();
  const { data: business, error: businessError } = await admin
    .schema("mediasis")
    .from("businesses")
    .select("uid, app_active")
    .eq("uid", context.activeBusinessId)
    .maybeSingle();
  if (businessError || !business?.uid || (context.mode !== "staff" && !business.app_active)) {
    return { success: false as const, message: "La app de pedidos no está activa para este negocio." };
  }
  if (context.mode === "clerk") {
    if (!context.appUserId) return { success: false as const, message: "No se pudo validar tu identidad." };
    const { data, error } = await admin.schema("mediasis").rpc("require_ordering_app_delivery_access", {
      p_business_id: context.activeBusinessId,
      p_actor_app_user_id: context.appUserId,
    });
    if (error || data !== true) {
      return { success: false as const, message: "No tenés permiso para administrar delivery." };
    }
  }

  let canUseMediasisCourier = false;
  try {
    canUseMediasisCourier = (await getBusinessPlanEntitlements(context.activeBusinessId, admin)).uberDelivery;
  } catch {
    return { success: false as const, message: "No se pudo verificar el plan del negocio." };
  }

  return {
    success: true as const,
    context,
    businessId: context.activeBusinessId,
    actorAppUserId: context.mode === "clerk" ? context.appUserId : null,
    admin,
    canManageAllLocations: context.mode === "legacy" || context.allLocations,
    allowedLocationIds: new Set(context.locations.map((location) => location.business_location_id)),
    canUseMediasisCourier,
  };
}

export function validateDeliveryLocation(
  locationId: string,
  authorized: Awaited<ReturnType<typeof requireDeliveryManagementAccess>>,
) {
  if (!authorized.success) return authorized;
  return authorized.canManageAllLocations || authorized.allowedLocationIds.has(locationId)
    ? { success: true as const }
    : { success: false as const, message: "No tenés acceso a esta ubicación." };
}
