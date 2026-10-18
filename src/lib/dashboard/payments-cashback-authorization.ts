import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusinessPlanEntitlements } from "@/lib/dashboard/plan-entitlements";

export const PAYMENT_METHODS_MANAGE_PERMISSION = "ordering_app.payment_methods.manage.full";
export const CASHBACK_MANAGE_PERMISSION = "ordering_app.cashback.manage.full";

async function requireOrderingAppAccess(permission: string, deniedMessage: string) {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) {
    return { success: false as const, message: "No hay un negocio activo." };
  }
  if (context.mode !== "legacy" && !hasDashboardPermission(context, permission)) {
    return { success: false as const, message: deniedMessage };
  }

  const admin = createAdminClient();
  let paymentMethodsManagedByMediasis = false;
  if ((permission === CASHBACK_MANAGE_PERMISSION || permission === PAYMENT_METHODS_MANAGE_PERMISSION) && context.mode !== "staff") {
    try {
      const entitlements = await getBusinessPlanEntitlements(context.activeBusinessId, admin);
      if (permission === CASHBACK_MANAGE_PERMISSION && !entitlements.cashback) {
        return { success: false as const, message: "Cashback está disponible desde el plan Basic." };
      }
      paymentMethodsManagedByMediasis = permission === PAYMENT_METHODS_MANAGE_PERMISSION
        && (entitlements.planKey === "uber_fijo" || entitlements.planKey === "uber_porcentaje");
    } catch {
      return { success: false as const, message: "No se pudo verificar el plan del negocio." };
    }
  }
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
    if (!context.appUserId) {
      return { success: false as const, message: "No se pudo validar tu identidad." };
    }
    const rpcName = permission === PAYMENT_METHODS_MANAGE_PERMISSION
      ? "require_ordering_app_payment_methods_access"
      : "require_ordering_app_cashback_access";
    const { data, error } = await admin.schema("mediasis").rpc(rpcName, {
      p_business_id: context.activeBusinessId,
      p_actor_app_user_id: context.appUserId,
    });
    if (error || data !== true) return { success: false as const, message: deniedMessage };
  }

  return {
    success: true as const,
    context,
    admin,
    businessId: context.activeBusinessId,
    actorAppUserId: context.mode === "clerk" ? context.appUserId : null,
    canManageAllLocations: context.mode === "legacy" || context.allLocations,
    paymentMethodsManagedByMediasis,
  };
}

export const requirePaymentMethodManagementAccess = () => requireOrderingAppAccess(
  PAYMENT_METHODS_MANAGE_PERMISSION,
  "No tenés permiso para administrar métodos de pago.",
);

export const requireCashbackManagementAccess = () => requireOrderingAppAccess(
  CASHBACK_MANAGE_PERMISSION,
  "No tenés permiso para administrar cashback.",
);
