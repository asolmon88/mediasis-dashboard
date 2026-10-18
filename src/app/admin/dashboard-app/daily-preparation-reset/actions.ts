"use server";

import { revalidatePath } from "next/cache";
import { requireAutomaticStatusesManagementAccess } from "@/lib/dashboard/automatic-statuses-authorization";
import {
  dailyPreparationResetSchema,
  type DailyPreparationResetInput,
  type DailyPreparationResetSettings,
} from "@/lib/dashboard/daily-preparation-reset";

type RpcResult = { success?: boolean; message?: string; data?: DailyPreparationResetSettings };
type Result = { success: true; settings: DailyPreparationResetSettings } | { success: false; message: string };

export async function getDailyPreparationResetSettings(): Promise<Result> {
  const access = await requireAutomaticStatusesManagementAccess();
  if (!access.success) return access;
  const { data, error } = await access.admin.schema("mediasis").rpc("get_dashboard_daily_preparation_reset_settings", {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
  });
  const result = data as RpcResult | null;
  if (error || !result?.success || !result.data) {
    return { success: false, message: "No se pudo cargar el reinicio diario de tiempos de preparación. Intentá de nuevo más tarde." };
  }
  return { success: true, settings: result.data };
}

export async function updateDailyPreparationResetSettings(input: DailyPreparationResetInput): Promise<Result> {
  const parsed = dailyPreparationResetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Seleccioná las ubicaciones y usá tiempos enteros entre 1 y 180 minutos." };
  }
  const access = await requireAutomaticStatusesManagementAccess();
  if (!access.success) return access;
  // Ownership and the affected location scope are checked again inside the RPC.
  const { data, error } = await access.admin.schema("mediasis").rpc("save_dashboard_daily_preparation_reset_settings", {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
    p_enabled: parsed.data.enabled,
    p_available_everywhere: parsed.data.availableEverywhere,
    p_location_ids: [...new Set(parsed.data.businessLocationIds)],
    p_method_values: parsed.data.methodValues.map((method) => ({ id: method.id, reset_minutes: method.resetMinutes })),
  });
  const result = data as RpcResult | null;
  if (error || !result?.success || !result.data) {
    const raw = error?.message ?? result?.message ?? "";
    const message = raw.includes("global configuration")
      ? "Solo un administrador con acceso a todas las ubicaciones puede cambiar esta configuración global."
      : raw.includes("Not authorized")
        ? "No tenés permiso para modificar una ubicación o un método compartido. Recargá la página para actualizar tus permisos."
        : raw.includes("timezone")
          ? "Configurá una zona horaria válida en los ajustes de mercado del negocio antes de activar el reinicio."
          : "No se pudo guardar el reinicio diario. Revisá los valores e intentá de nuevo.";
    return { success: false, message };
  }
  revalidatePath("/admin/dashboard-app/daily-preparation-reset");
  return { success: true, settings: result.data };
}
