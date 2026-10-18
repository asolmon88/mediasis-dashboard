import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export const DOMAINS_READ_PERMISSION = "domains.read";
export const DOMAINS_MANAGE_PERMISSION = "domains.manage";

const READ_DENIED = "No tenés acceso a la configuración de dominios.";
const MANAGE_DENIED = "Tu plan incluye la administración del dominio por parte del equipo de Mediasis.";

type DomainAccess =
  | { success: false; message: string }
  | {
      success: true;
      context: NonNullable<Awaited<ReturnType<typeof getDashboardAuthorizationContext>>>;
      businessId: string;
      admin: ReturnType<typeof createAdminClient>;
      planKey: string | null;
      canManage: boolean;
      mediasisManaged: boolean;
    };

async function getDomainAccess(): Promise<DomainAccess> {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) return { success: false, message: READ_DENIED };

  const hasReadPermission = context.mode === "legacy"
    || hasDashboardPermission(context, DOMAINS_READ_PERMISSION)
    || hasDashboardPermission(context, DOMAINS_MANAGE_PERMISSION);
  if (context.mode !== "staff" && !hasReadPermission) return { success: false, message: READ_DENIED };

  const admin = createAdminClient();
  const { data: assignment, error: assignmentError } = await admin
    .schema("mediasis")
    .from("business_plan_assignments")
    .select("subscription_plan_id")
    .eq("business_id", context.activeBusinessId)
    .maybeSingle();

  // A plan lookup failure must never grant domain management. Viewing remains
  // available so a business can still see the address Mediasis has configured.
  let planKey: string | null = null;
  let planVerified = !assignmentError;
  if (assignment?.subscription_plan_id && !assignmentError) {
    const { data: plan, error: planError } = await admin
      .schema("mediasis")
      .from("subscription_plans")
      .select("stable_key, active")
      .eq("subscription_plan_id", assignment.subscription_plan_id)
      .maybeSingle();
    planVerified = !planError;
    planKey = plan?.active ? plan.stable_key : null;
  }

  const mediasisManaged = planKey === "uber_fijo" || planKey === "uber_porcentaje";
  let canManage = false;
  if (context.mode === "staff") {
    // The staff dashboard context is created only after is_mediasis_staff_actor
    // succeeds. Staff therefore administer the selected business even when
    // they are not a member of that business.
    canManage = true;
  } else if (planVerified && planKey && !mediasisManaged) {
    canManage = context.mode === "legacy" || hasDashboardPermission(context, DOMAINS_MANAGE_PERMISSION);
  }

  return { success: true, context, businessId: context.activeBusinessId, admin, planKey, canManage, mediasisManaged };
}

export async function requireDomainAccess(manage = false) {
  const authorized = await getDomainAccess();
  if (!authorized.success || !manage || authorized.canManage) return authorized;
  return { success: false as const, message: MANAGE_DENIED };
}
