'use server'

import { z } from "zod";
import {
  getVisiblePaymentMethodCountForLocation,
  requireStorefrontManagementAccess,
  validateStorefrontLocation,
} from "@/lib/dashboard/storefront-authorization";

export async function getCheckoutCardsData(businessLocationId: string) {
  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) {
    return {
      success: false,
      message: authorized.message,
      data: null,
      paymentMethodCount: 0,
    };
  }
  const locationAccess = validateStorefrontLocation(businessLocationId, authorized);
  if (!locationAccess.success) return { ...locationAccess, data: null, paymentMethodCount: 0 };

  const { data: location, error: locationError } = await authorized.admin
    .schema("mediasis")
    .from("business_location")
    .select("business_location_id")
    .eq("business_location_id", businessLocationId)
    .eq("business_uid", authorized.businessId)
    .maybeSingle();

  if (locationError || !location) {
    return {
      success: false,
      message: "La ubicación activa no pertenece al negocio.",
      data: null,
      paymentMethodCount: 0,
    };
  }

  const paymentMethodsResult = await getVisiblePaymentMethodCountForLocation(authorized, businessLocationId);
  if (!paymentMethodsResult.success) {
    return {
      success: false,
      message: paymentMethodsResult.message,
      data: null,
      paymentMethodCount: 0,
    };
  }
  const paymentMethodCount = paymentMethodsResult.count;
  const { data, error } = await authorized.admin.schema("mediasis").rpc("storefront_checkout_json", {
    p_business_id: authorized.businessId,
  });

  if (error) {
    return {
      success: false,
      message: `Error al obtener los datos de la tienda: ${JSON.stringify(error, null, 2)}`,
      data: null,
      paymentMethodCount: paymentMethodCount ?? 0,
    };
  }

  return {
    success: true,
    message: "Datos obtenidos con éxito.",
    data,
    paymentMethodCount: paymentMethodCount ?? 0,
  };
}

const LoyaltyProgramTypeSchema = z.enum(["stamps", "cashback", "loyalty"]);

const LoyaltyProgramConfigSchema = z.object({
  loyalty_program_id: z.string().uuid().optional(),
  program_type: LoyaltyProgramTypeSchema,
  card_url: z.string().trim().url("Debe ingresar un URL válido"),
  active: z.boolean(),
  location_ids: z.array(z.string().uuid()).default([]),
});

const LoyaltyProgramConfigsSchema = z.array(LoyaltyProgramConfigSchema);
const LoyaltyProgramDeleteIdsSchema = z.array(z.string().uuid()).default([]);

export type LoyaltyProgramConfigInput = z.infer<typeof LoyaltyProgramConfigSchema>;

export type LoyaltyProgramConfigRecord = LoyaltyProgramConfigInput & {
  business_id: string;
  scope: "all" | "specific";
  loyalty_program_id: string;
  location_ids: string[];
  created_at?: string;
  updated_at?: string;
  scope_locked?: boolean;
  delete_allowed?: boolean;
};

export async function getLoyaltyProgramsForBusiness() {
  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) return { success: false, message: authorized.message, data: [] };

  const { data, error } = await authorized.admin
    .schema("mediasis")
    .rpc("list_loyalty_programs_for_business", {
      p_business_id: authorized.businessId,
    });

  if (error) {
    return {
      success: false,
      message: `Error al obtener programas de lealtad: ${JSON.stringify(error, null, 2)}`,
      data: [],
    };
  }

  if (!data || data.success !== true || !Array.isArray(data.data)) {
    return {
      success: false,
      message: data?.message ?? "No se pudieron obtener los programas de lealtad.",
      data: [],
    };
  }

  const records = data.data as LoyaltyProgramConfigRecord[];
  const sanitized = authorized.canManageAllLocations ? records : records.map((record) => {
    const visibleIds = record.location_ids.filter((id) => authorized.allowedLocationIds.has(id));
    const hasProtectedLocations = record.scope === "all" || visibleIds.length !== record.location_ids.length;
    return { ...record, location_ids: visibleIds, scope_locked: record.scope === "all", delete_allowed: !hasProtectedLocations };
  });
  return {
    success: true,
    message: data.message ?? "Programas obtenidos con éxito.",
    data: sanitized,
  };
}

export async function upsertLoyaltyPrograms({
  configs,
  delete_ids = [],
}: {
  configs: LoyaltyProgramConfigInput[]
  delete_ids?: string[]
}) {
  const parsed = LoyaltyProgramConfigsSchema.safeParse(configs);
  if (parsed.error) {
    return {
      success: false,
      message: `Error al procesar los programas de lealtad: ${JSON.stringify(parsed.error, null, 2)}`,
    };
  }

  const parsedDeleteIds = LoyaltyProgramDeleteIdsSchema.safeParse(delete_ids);
  if (parsedDeleteIds.error) {
    return {
      success: false,
      message: `Error al procesar los programas eliminados: ${JSON.stringify(parsedDeleteIds.error, null, 2)}`,
    };
  }

  const authorized = await requireStorefrontManagementAccess();
  if (!authorized.success) return authorized;

  if (authorized.context.mode !== "legacy") {
    const { data, error } = await authorized.admin.schema("mediasis").rpc("save_ordering_app_loyalty_programs", {
      p_business_id: authorized.businessId,
      p_actor_app_user_id: authorized.context.mode === "clerk" ? authorized.context.appUserId : null,
      p_configs: parsed.data,
      p_delete_ids: parsedDeleteIds.data,
    });
    return error || !data?.success
      ? { success: false, message: error?.message ?? data?.message ?? "No se pudieron guardar los programas de lealtad." }
      : { success: true, message: "Programas de lealtad actualizados." };
  }

  const activeConfigs = parsed.data.filter((config) => config.active);
  const activeAllConfigs = activeConfigs.filter((config) => config.location_ids.length === 0);
  const usedLocationIds = new Set<string>();

  if (activeAllConfigs.length > 1) {
    return {
      success: false,
      message: "Solo puede existir un programa de lealtad para todas las ubicaciones.",
    };
  }

  if (activeAllConfigs.length > 0 && activeConfigs.length > 1) {
    return {
      success: false,
      message: "No puede combinar un programa para todas las ubicaciones con programas por ubicación.",
    };
  }

  for (const config of activeConfigs) {
    if (activeConfigs.length > 1 && config.location_ids.length === 0) {
      return {
        success: false,
        message: "Cada programa activo debe tener ubicaciones específicas cuando hay más de un enlace.",
      };
    }

    for (const locationId of config.location_ids) {
      if (usedLocationIds.has(locationId)) {
        return {
          success: false,
          message: "Una ubicación no puede estar asignada a más de un programa de lealtad.",
        };
      }
      usedLocationIds.add(locationId);
    }
  }

  for (const loyaltyProgramId of parsedDeleteIds.data) {
    const { data, error } = await authorized.admin.schema("mediasis").rpc("delete_loyalty_program", {
      p_loyalty_program_id: loyaltyProgramId,
    });

    if (error) {
      return {
        success: false,
        message: `Error al eliminar programa de lealtad: ${JSON.stringify(error, null, 2)}`,
      };
    }

    if (!data || data.success !== true) {
      return {
        success: false,
        message: data?.message ?? "No se pudo eliminar el programa de lealtad.",
      };
    }
  }

  for (const config of parsed.data) {
    const locationIds = config.location_ids.length > 0 ? config.location_ids : null;
    const rpcName = config.loyalty_program_id
      ? "update_loyalty_program"
      : "add_loyalty_program_to_business";
    const rpcParams = config.loyalty_program_id
      ? {
          p_loyalty_program_id: config.loyalty_program_id,
          p_program_type: config.program_type,
          p_card_url: config.card_url,
          p_active: config.active,
          p_location_ids: locationIds,
        }
      : {
          p_business_id: authorized.businessId,
          p_program_type: config.program_type,
          p_card_url: config.card_url,
          p_location_ids: locationIds,
        };

    const { data, error } = await authorized.admin.schema("mediasis").rpc(rpcName, rpcParams);

    if (error) {
      return {
        success: false,
        message: `Error al guardar programa de lealtad: ${JSON.stringify(error, null, 2)}`,
      };
    }

    if (!data || data.success !== true) {
      return {
        success: false,
        message: data?.message ?? "No se pudo guardar el programa de lealtad.",
      };
    }
  }

  return { success: true, message: "Programas de lealtad actualizados." };
}
