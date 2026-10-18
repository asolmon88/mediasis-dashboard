import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export const DEVELOPER_MANAGE_PERMISSION = "developer.manage.full";

export async function requireDeveloperManagementAccess() {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) {
    return { success: false as const, message: "No hay un negocio activo." };
  }
  if (
    context.mode !== "legacy" &&
    !hasDashboardPermission(context, DEVELOPER_MANAGE_PERMISSION)
  ) {
    return {
      success: false as const,
      message: "No tenés permiso para administrar las herramientas de desarrollador.",
    };
  }

  const admin = createAdminClient();
  if (context.mode === "clerk") {
    if (!context.appUserId) {
      return { success: false as const, message: "No se pudo validar tu identidad." };
    }
    const { data, error } = await admin.schema("mediasis").rpc(
      "require_dashboard_developer_access",
      {
        p_business_id: context.activeBusinessId,
        p_actor_app_user_id: context.appUserId,
      },
    );
    if (error || data !== true) {
      return {
        success: false as const,
        message: "No tenés permiso para administrar las herramientas de desarrollador.",
      };
    }
  }

  return {
    success: true as const,
    context,
    admin,
    businessId: context.activeBusinessId,
    actorAppUserId: context.mode === "clerk" ? context.appUserId : null,
  };
}
