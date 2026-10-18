import type { BusinessWebhookRow, BusinessWebhookRows } from "@/lib/types/dashboardTypes";

export function normalizeWebhookRows(value: unknown): BusinessWebhookRows {
  if (!Array.isArray(value)) return [];

  return value.map((row) => {
    const item = row as Partial<BusinessWebhookRow>;

    return {
      webhook_id: String(item.webhook_id ?? ""),
      endpoint_url: String(item.endpoint_url ?? ""),
      enabled: Boolean(item.enabled),
      scope: item.scope ?? "all",
      event_types: Array.isArray(item.event_types) ? item.event_types.map(String) : [],
      location_ids: Array.isArray(item.location_ids) ? item.location_ids.map(String) : [],
      created_at: String(item.created_at ?? ""),
      updated_at: String(item.updated_at ?? ""),
      has_secret: Boolean(item.has_secret),
    };
  });
}
