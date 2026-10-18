import "server-only";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { hasDashboardPermission } from "@/lib/dashboard/auth-types";
import { createAdminClient } from "@/lib/supabase/admin";

export const BILLING_READ_PERMISSION = "billing.read";
export const BILLING_MANAGE_PERMISSION = "billing.manage";

type BillingAccess =
  | { success: false; message: string }
  | {
      success: true;
      context: NonNullable<Awaited<ReturnType<typeof getDashboardAuthorizationContext>>>;
      businessId: string;
      admin: ReturnType<typeof createAdminClient>;
      canManage: boolean;
    };

export async function requireBillingAccess(manage = false): Promise<BillingAccess> {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId) return { success: false, message: "Seleccioná un negocio para consultar su facturación." };
  const admin = createAdminClient();
  // The account owner is the billing owner. This must not depend on a role
  // permission that may have been omitted from an otherwise valid ownership
  // record.
  const { data: owner } = context.appUserId
    ? await admin.schema("mediasis").from("business_account_owners")
      .select("owner_app_user_id").eq("business_id", context.activeBusinessId).maybeSingle()
    : { data: null };
  const isAccountOwner = Boolean(context.appUserId && owner?.owner_app_user_id === context.appUserId);
  if (context.mode !== "legacy") {
    const required = manage ? BILLING_MANAGE_PERMISSION : BILLING_READ_PERMISSION;
    if (!isAccountOwner && !hasDashboardPermission(context, required) && !(manage === false && hasDashboardPermission(context, BILLING_MANAGE_PERMISSION))) {
      return { success: false, message: "No tenés permiso para acceder a la facturación." };
    }
  }
  return {
    success: true,
    context,
    businessId: context.activeBusinessId,
    admin,
    canManage: context.mode === "legacy" || isAccountOwner || hasDashboardPermission(context, BILLING_MANAGE_PERMISSION),
  };
}
