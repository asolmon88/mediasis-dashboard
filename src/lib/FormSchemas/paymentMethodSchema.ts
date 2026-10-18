import { z } from "zod";

export const PaymentMethodSchema = z.object({
  payment_method_id: z.string().trim().min(1, "Método de pago requerido"),
  business_location_ids: z
    .array(z.string().trim().min(1, "Ubicación requerida"))
    .optional(),
  scope: z.enum(["all", "specific"]),
  visible: z.boolean(),
});

export type PaymentMethodInput = z.infer<typeof PaymentMethodSchema>;
