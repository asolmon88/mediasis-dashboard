"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDashboardAuthorizationContext } from "@/lib/dashboard/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const correctionSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  reason: z.string().trim().min(10, "Explicá el motivo de la corrección."),
});

export async function correctBusinessMarket(input: { countryCode: string; reason: string }) {
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  const context = await getDashboardAuthorizationContext();
  if (context?.mode !== "staff" || !context.activeBusinessId || !context.appUserId) {
    return { success: false, message: "Solo el personal autorizado de Mediasis puede corregir esta configuración." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.schema("mediasis").rpc("correct_business_market_settings", {
    p_business_id: context.activeBusinessId,
    p_country_code: parsed.data.countryCode,
    p_reason: parsed.data.reason,
    p_actor_app_user_id: context.appUserId,
  });
  if (error || !data?.success) return { success: false, message: error?.message ?? data?.message ?? "No se pudo corregir la configuración." };
  revalidatePath("/admin", "layout");
  return { success: true, message: "Configuración regional actualizada." };
}
