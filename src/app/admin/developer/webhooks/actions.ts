"use server";

import {
  WebhookActionInput,
  WebhookActionSchema,
  WebhookCreateFormInput,
  WebhookCreateSchema,
} from "@/lib/FormSchemas/webhookSchema";
import { requireDeveloperManagementAccess } from "@/lib/dashboard/developer-authorization";
import type { BusinessLocations } from "@/lib/types/dashboardTypes";
import { normalizeWebhookRows } from "@/lib/webhooks/normalize";
import { encryptWebhookSecret, generateWebhookSecret } from "@/lib/webhooks/secrets";

type DeveloperRpcResult = {
  success?: boolean;
  message?: string;
  data?: unknown;
  webhook_id?: string;
};

async function callDeveloperRpc(name: string, args: Record<string, unknown>) {
  const access = await requireDeveloperManagementAccess();
  if (!access.success) return access;
  const { data, error } = await access.admin.schema("mediasis").rpc(name, {
    p_business_id: access.businessId,
    p_actor_app_user_id: access.actorAppUserId,
    ...args,
  });
  const result = data as DeveloperRpcResult | null;
  if (error || !result?.success) {
    return {
      success: false as const,
      message: error?.message ?? result?.message ?? "La operación no pudo completarse.",
    };
  }
  return { success: true as const, result };
}

export async function getBusinessWebhooksData() {
  const access = await requireDeveloperManagementAccess();
  if (!access.success) return access;
  const { data, error } = await access.admin.schema("mediasis").rpc(
    "get_dashboard_business_webhooks",
    {
      p_business_id: access.businessId,
      p_actor_app_user_id: access.actorAppUserId,
    },
  );
  const result = data as DeveloperRpcResult | null;
  if (error || !result?.success) {
    return { success: false as const, message: "No se pudieron cargar los webhooks." };
  }
  return {
    success: true as const,
    webhooks: normalizeWebhookRows(result.data),
    locations: access.context.locations as BusinessLocations,
    canManageAllLocations: access.context.mode === "legacy" || access.context.allLocations,
  };
}

export async function createBusinessWebhook(values: WebhookCreateFormInput) {
  const parsed = WebhookCreateSchema.safeParse(values);
  if (!parsed.success) return { success: false as const, message: "Datos inválidos" };
  const masterKey = process.env.WEBHOOK_SECRET_MASTER_KEY;
  if (!masterKey) return { success: false as const, message: "No se ha configurado la llave de cifrado de webhooks" };

  const plaintextSecret = generateWebhookSecret();
  const encryptedSecret = encryptWebhookSecret(plaintextSecret, masterKey);
  const response = await callDeveloperRpc("create_dashboard_business_webhook", {
    p_endpoint_url: parsed.data.endpoint_url,
    p_encrypted_secret_token: encryptedSecret,
    p_event_types: parsed.data.event_types,
    p_location_ids: parsed.data.location_ids.length ? parsed.data.location_ids : null,
    p_enabled: parsed.data.enabled,
  });
  if (!response.success) return response;
  const list = await callDeveloperRpc("get_dashboard_business_webhooks", {});
  if (!list.success) return { success: false as const, message: "El webhook fue creado, pero no se pudo recargar la tabla" };
  const webhook = normalizeWebhookRows(list.result.data).find(
    (row) => row.webhook_id === response.result.webhook_id,
  );
  if (!webhook) return { success: false as const, message: "El webhook fue creado, pero no se encontró en la respuesta" };
  return { success: true as const, data: { webhook, plaintext_secret: plaintextSecret } };
}

export async function rotateBusinessWebhookSecret(values: WebhookActionInput) {
  const parsed = WebhookActionSchema.safeParse(values);
  if (!parsed.success) return { success: false as const, message: "Webhook inválido" };
  const masterKey = process.env.WEBHOOK_SECRET_MASTER_KEY;
  if (!masterKey) return { success: false as const, message: "No se ha configurado la llave de cifrado de webhooks" };

  const plaintextSecret = generateWebhookSecret();
  const encryptedSecret = encryptWebhookSecret(plaintextSecret, masterKey);
  const response = await callDeveloperRpc("rotate_dashboard_business_webhook_secret", {
    p_webhook_id: parsed.data.webhook_id,
    p_encrypted_secret_token: encryptedSecret,
  });
  if (!response.success) return response;
  const list = await callDeveloperRpc("get_dashboard_business_webhooks", {});
  if (!list.success) return { success: false as const, message: "El secreto fue rotado, pero no se pudo recargar la tabla" };
  const webhook = normalizeWebhookRows(list.result.data).find(
    (row) => row.webhook_id === parsed.data.webhook_id,
  );
  if (!webhook) return { success: false as const, message: "El webhook no se encontró después de rotar el secreto" };
  return { success: true as const, data: { webhook, plaintext_secret: plaintextSecret } };
}

export async function deleteBusinessWebhook(values: WebhookActionInput) {
  const parsed = WebhookActionSchema.safeParse(values);
  if (!parsed.success) return { success: false as const, message: "Webhook inválido" };
  const response = await callDeveloperRpc("delete_dashboard_business_webhook", {
    p_webhook_id: parsed.data.webhook_id,
  });
  return response.success ? { success: true as const } : response;
}
