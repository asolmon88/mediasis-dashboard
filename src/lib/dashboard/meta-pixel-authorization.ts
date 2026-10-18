import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export const META_PIXEL_MANAGE_PERMISSION = "marketing.facebook_pixel.manage.full";
export const META_PIXEL_STAFF_MANAGE_PERMISSION = "businesses.facebook_pixel.manage";

const READ_DENIED = "No tenés acceso a la configuración de Facebook pixel.";
const MANAGE_DENIED = "Tu plan permite ver la conexión de Facebook pixel, pero los cambios los gestiona el equipo de Mediasis.";

type MetaPixelAccess =
  | { success: false; message: string }
  | {
      success: true;
      context: NonNullable<Awaited<ReturnType<typeof getDashboardAuthorizationContext>>>;
      businessId: string;
      admin: ReturnType<typeof createAdminClient>;
      planKey: string | null;
      canManage: boolean;
    };

async function getMetaPixelAccess(): Promise<MetaPixelAccess> {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) return { success: false, message: READ_DENIED };

  const admin = createAdminClient();
  const { data: assignment, error: assignmentError } = await admin
    .schema("mediasis")
    .from("business_plan_assignments")
    .select("subscription_plan_id")
    .eq("business_id", context.activeBusinessId)
    .maybeSingle();
  if (assignmentError) {
    console.error("[meta-pixel] Could not load business plan assignment", {
      businessId: context.activeBusinessId,
      code: assignmentError.code,
      message: assignmentError.message,
    });
    return { success: false, message: "No se pudo verificar el plan del negocio." };
  }

  let planKey: string | null = null;
  if (assignment?.subscription_plan_id) {
    const { data: subscriptionPlan, error: planError } = await admin
      .schema("mediasis")
      .from("subscription_plans")
      .select("stable_key, active")
      .eq("subscription_plan_id", assignment.subscription_plan_id)
      .maybeSingle();
    if (planError) {
      console.error("[meta-pixel] Could not load subscription plan", {
        businessId: context.activeBusinessId,
        subscriptionPlanId: assignment.subscription_plan_id,
        code: planError.code,
        message: planError.message,
      });
      return { success: false, message: "No se pudo verificar el plan del negocio." };
    }
    planKey = subscriptionPlan?.active ? subscriptionPlan.stable_key : null;
  }
  let canManage = false;

  if (context.mode === "staff") {
    if (!context.appUserId) return { success: false, message: READ_DENIED };
    const { data: staffCanManage, error: staffError } = await admin.schema("mediasis").rpc("staff_actor_has_permission", {
      p_actor_app_user_id: context.appUserId,
      p_permission_key: META_PIXEL_STAFF_MANAGE_PERMISSION,
    });
    if (staffError) return { success: false, message: "No se pudo verificar el acceso de Mediasis." };
    canManage = staffCanManage === true;
  } else if (planKey === "basic") {
    canManage = context.mode === "legacy" || hasDashboardPermission(context, META_PIXEL_MANAGE_PERMISSION);
  }

  return { success: true, context, businessId: context.activeBusinessId, admin, planKey, canManage };
}

export async function requireMetaPixelReadAccess() {
  return getMetaPixelAccess();
}

export async function requireMetaPixelManagementAccess() {
  const authorized = await getMetaPixelAccess();
  if (!authorized.success || authorized.canManage) return authorized;
  return { success: false as const, message: MANAGE_DENIED };
}
