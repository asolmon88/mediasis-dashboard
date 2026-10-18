"use server";

import { requireDeveloperManagementAccess } from "@/lib/dashboard/developer-authorization";
import { z } from "zod";

const MAX_CODE_BYTES = 50 * 1024;
const CustomTrackingCodeSchema = z.object({
  custom_tracking_code: z.string().refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_CODE_BYTES,
    "El código no puede superar 50 KB",
  ),
});

export type CustomTrackingCodeInput = z.infer<typeof CustomTrackingCodeSchema>;

async function callDeveloperRpc(name: string, args: Record<string, unknown>) {
  const access = await requireDeveloperManagementAccess();
  if (!access.success) return access;
  const { data, error } = await access.admin.schema("mediasis").rpc(name, {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
    ...args,
  });
  const result = data as {
    success?: boolean;
    message?: string;
    custom_tracking_code?: string | null;
  } | null;
  if (error || !result?.success) {
    return {
      success: false as const,
      message: error?.message ?? result?.message ?? "La operación no pudo completarse.",
    };
  }
  return { success: true as const, result };
}

export async function getCustomTrackingCode() {
  const response = await callDeveloperRpc("get_dashboard_custom_tracking_code", {});
  return response.success
    ? { success: true as const, code: response.result.custom_tracking_code ?? "" }
    : response;
}

export async function updateCustomTrackingCode(values: CustomTrackingCodeInput) {
  const parsed = CustomTrackingCodeSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Código inválido" };
  }
  const response = await callDeveloperRpc("update_dashboard_custom_tracking_code", {
    p_custom_tracking_code: parsed.data.custom_tracking_code,
  });
  return response.success
    ? { success: true, message: "Código personalizado actualizado" }
    : { success: false, message: response.message };
}
