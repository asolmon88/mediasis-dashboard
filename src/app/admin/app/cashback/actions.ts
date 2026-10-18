"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCashbackManagementAccess } from "@/lib/dashboard/payments-cashback-authorization";

const cashbackSettingsSchema = z.object({
  enabled: z.boolean(),
  percentage: z.number().min(0).max(100).refine(
    (value) => Math.round(value * 100) === value * 100,
    "El porcentaje puede tener como máximo dos decimales.",
  ),
});

type CashbackRpcResult = {
  success?: boolean;
  message?: string;
  data?: { enabled?: boolean; percentage?: number; updated_at?: string | null };
};

export async function getOrderingAppCashbackSettings() {
  const access = await requireCashbackManagementAccess();
  if (!access.success) return access;
  const { data, error } = await access.admin.schema("mediasis").rpc("get_ordering_app_cashback_settings", {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
  });
  const result = data as CashbackRpcResult | null;
  if (error || !result?.success) {
    return { success: false as const, message: error?.message ?? result?.message ?? "No se pudo cargar el cashback." };
  }
  return {
    success: true as const,
    enabled: Boolean(result.data?.enabled),
    percentage: Number(result.data?.percentage ?? 0),
  };
}

export async function updateCashbackSettings(input: unknown) {
  const parsed = cashbackSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Revisá la configuración." };
  }
  const access = await requireCashbackManagementAccess();
  if (!access.success) return access;
  const { data, error } = await access.admin.schema("mediasis").rpc("update_ordering_app_cashback_settings", {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
    p_enabled: parsed.data.enabled,
    p_percentage: parsed.data.percentage,
  });
  const result = data as CashbackRpcResult | null;
  if (error || !result?.success) {
    return { success: false, message: error?.message ?? result?.message ?? "No se pudo guardar el cashback." };
  }
  revalidatePath("/admin/app/cashback");
  return { success: true };
}
