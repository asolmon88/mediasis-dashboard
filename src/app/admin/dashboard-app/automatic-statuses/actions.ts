'use server'

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAutomaticStatusesManagementAccess } from "@/lib/dashboard/automatic-statuses-authorization";

export type AutomaticStatusSettingsInput = { enabled: boolean; availableEverywhere: boolean; businessLocationIds: string[] };

const settingsSchema = z.object({
  enabled: z.boolean(),
  availableEverywhere: z.boolean(),
  businessLocationIds: z.array(z.string().uuid()).max(100),
});

type SettingsRpcResult = {
  success?: boolean;
  message?: string;
  data?: {
    enabled?: boolean;
    available_everywhere?: boolean;
    global_configuration_active?: boolean;
    selected_location_ids?: string[];
    locations?: Array<{ business_location_id: string; short_name: string }>;
  };
};

export async function getAutomaticStatusSettings() {
  const access = await requireAutomaticStatusesManagementAccess();
  if (!access.success) return access;
  const { data, error } = await access.admin.schema("mediasis").rpc("get_dashboard_automatic_status_settings", {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
  });
  const result = data as SettingsRpcResult | null;
  if (error || !result?.success || !result.data) {
    return { success: false as const, message: error?.message ?? result?.message ?? "No se pudieron cargar los estados automáticos." };
  }
  return {
    success: true as const,
    locations: result.data.locations ?? [],
    settings: {
      enabled: Boolean(result.data.enabled),
      availableEverywhere: Boolean(result.data.available_everywhere),
      businessLocationIds: result.data.selected_location_ids ?? [],
    },
    canManageAllLocations: access.canManageAllLocations,
    globalConfigurationActive: Boolean(result.data.global_configuration_active),
  };
}

export async function updateAutomaticStatusSettings(input: AutomaticStatusSettingsInput) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Revisá la configuración y las ubicaciones seleccionadas." };
  const access = await requireAutomaticStatusesManagementAccess();
  if (!access.success) return access;
  const locationIds = Array.from(new Set(parsed.data.businessLocationIds));
  if (parsed.data.enabled && !parsed.data.availableEverywhere && locationIds.length === 0) {
    return { success: false, message: "Seleccioná al menos una ubicación o activá todas las ubicaciones." };
  }
  const { data, error } = await access.admin.schema("mediasis").rpc("save_dashboard_automatic_status_settings", {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
    p_enabled: parsed.data.enabled,
    p_available_everywhere: parsed.data.availableEverywhere,
    p_location_ids: locationIds,
  });
  const result = data as SettingsRpcResult | null;
  if (error || !result?.success) {
    const rawMessage = error?.message ?? result?.message ?? "";
    const message = rawMessage.includes("global configuration")
      ? "Solo un administrador con acceso a todas las ubicaciones puede cambiar esta configuración global."
      : rawMessage.includes("Not authorized")
        ? "No tenés permiso para modificar una o más ubicaciones."
        : rawMessage || "No se pudo guardar la configuración.";
    return { success: false, message };
  }
  revalidatePath("/admin/dashboard-app/automatic-statuses");
  return { success: true };
}
