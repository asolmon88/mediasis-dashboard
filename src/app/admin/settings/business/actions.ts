"use server";

import { revalidatePath } from "next/cache";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function requestBusinessDeletion(confirmationName: string) {
  const context = await getDashboardAuthorizationContext();
  if (!context?.activeBusinessId || !context.appUserId) {
    return { success: false as const, message: "Seleccioná un negocio para eliminarlo." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.schema("mediasis").rpc("request_business_deletion", {
    p_business_id: context.activeBusinessId,
    p_owner_app_user_id: context.appUserId,
    p_confirmation_name: confirmationName,
  });
  if (error || !data?.success) return { success: false as const, message: error?.message ?? "No se pudo solicitar la eliminación." };
  revalidatePath("/admin", "layout");
  return { success: true as const, purgeAfter: data.purge_after as string };
}
