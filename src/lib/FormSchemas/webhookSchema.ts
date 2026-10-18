import { z } from "zod";

export const WebhookEventTypeSchema = z.enum(["order.paid"]);

export const WEBHOOK_EVENT_TYPE_OPTIONS = [
  {
    label: "Orden pagada",
    value: "order.paid",
    available: true,
  },
  // Future event subscriptions:
  // { label: "Orden creada", value: "order.created", available: false },
  // { label: "Orden reembolsada", value: "order.refunded", available: false },
  // { label: "Orden cancelada", value: "order.canceled", available: false },
] as const;

export const WebhookCreateSchema = z.object({
  endpoint_url: z
    .string()
    .trim()
    .min(1, "URL requerida")
    .url("URL invalida")
    .refine((value) => value.startsWith("https://"), {
      message: "La URL debe iniciar con https://",
    }),
  enabled: z.boolean().default(true),
  event_types: z.array(WebhookEventTypeSchema).min(1, "Seleccione al menos un evento"),
  location_ids: z.array(z.string().trim().uuid("Ubicación invalida")).default([]),
});

export const WebhookIdSchema = z.string().trim().uuid("Webhook invalido");

export const WebhookActionSchema = z.object({
  webhook_id: WebhookIdSchema,
});

export type WebhookCreateFormInput = z.input<typeof WebhookCreateSchema>;
export type WebhookCreateInput = z.output<typeof WebhookCreateSchema>;
export type WebhookActionInput = z.infer<typeof WebhookActionSchema>;
