import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export const STOREFRONT_MANAGE_PERMISSION = "ordering_app.storefront.manage.full";

export async function requireStorefrontManagementAccess() {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) {
    return { success: false as const, message: "No hay un negocio activo." };
  }
  if (context.mode !== "legacy" && !hasDashboardPermission(context, STOREFRONT_MANAGE_PERMISSION)) {
    return { success: false as const, message: "No tenés permiso para administrar la app de pedidos." };
  }

  const admin = createAdminClient();
  if (context.mode === "clerk") {
    if (!context.appUserId) return { success: false as const, message: "No se pudo validar tu identidad." };
    const { data, error } = await admin.schema("mediasis").rpc("require_ordering_app_storefront_access", {
      p_business_id: context.activeBusinessId,
      p_actor_app_user_id: context.appUserId,
    });
    if (error || data !== true) {
      return { success: false as const, message: "No tenés permiso para administrar la app de pedidos." };
    }
  }

  return {
    success: true as const,
    context,
    businessId: context.activeBusinessId,
    admin,
    canManageAllLocations: context.mode === "legacy" || context.allLocations,
    allowedLocationIds: new Set(context.locations.map((location) => location.business_location_id)),
  };
}

export function validateStorefrontLocation(
  locationId: string,
  authorized: Awaited<ReturnType<typeof requireStorefrontManagementAccess>>,
) {
  if (!authorized.success) return authorized;
  return authorized.canManageAllLocations || authorized.allowedLocationIds.has(locationId)
    ? { success: true as const }
    : { success: false as const, message: "No tenés acceso a esta ubicación." };
}

/**
 * Checkout only needs to know whether the selected location has a visible
 * payment method. Do not call get_visible_payment_methods here: that RPC is an
 * Orders capability and authorizes with orders.manage.full. Storefront
 * managers are authorized above with ordering_app.storefront.manage.full, so
 * this service-side lookup derives the business and location from that trusted
 * context and returns no payment-method identifiers to the browser.
 */
export async function getVisiblePaymentMethodCountForLocation(
  authorized: Extract<Awaited<ReturnType<typeof requireStorefrontManagementAccess>>, { success: true }>,
  locationId: string,
) {
  const locationAccess = validateStorefrontLocation(locationId, authorized);
  if (!locationAccess.success) return locationAccess;

  const { data: methods, error: methodsError } = await authorized.admin
    .schema("mediasis")
    .from("business_payment_method")
    .select("business_payment_method_id, scope, payment_method!inner(uid)")
    .eq("business_id", authorized.businessId)
    .eq("visible", true)
    .eq("payment_method.visibility", true);

  if (methodsError) {
    return { success: false as const, message: "No se pudieron validar los métodos de pago." };
  }

  const allLocationCount = (methods ?? []).filter((method) => method.scope === "all").length;
  const specificMethodIds = (methods ?? [])
    .filter((method) => method.scope === "specific")
    .map((method) => method.business_payment_method_id);

  if (specificMethodIds.length === 0) {
    return { success: true as const, count: allLocationCount };
  }

  const { data: assignments, error: assignmentsError } = await authorized.admin
    .schema("mediasis")
    .from("business_payment_method_location")
    .select("business_payment_method_id")
    .eq("business_location_id", locationId)
    .in("business_payment_method_id", specificMethodIds);

  if (assignmentsError) {
    return { success: false as const, message: "No se pudieron validar los métodos de pago." };
  }

  return {
    success: true as const,
    count: allLocationCount + new Set((assignments ?? []).map((row) => row.business_payment_method_id)).size,
  };
}
