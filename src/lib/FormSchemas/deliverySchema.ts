import { z } from "zod";

import { CheckoutOptionSchema } from "./checkoutSchema";

const nonNegativeNumber = z.number().min(0, "El valor no puede ser negativo");

export const DeliverySchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido"),
  visibility: z.boolean(),
  instructions: z.string().trim().optional(),
  payment_methods: z.array(z.string().trim().min(1, "Método requerido")),
  pickup_ready_offset_minutes: z
    .number()
    .int("Debe ser un número entero")
    .min(1, "Debe ser al menos 1 minuto")
    .max(20, "No se permite configurar un tiempo de preparación mayor a 20 minutos."),
  fee: nonNegativeNumber.optional(),
  min_order_value: nonNegativeNumber.optional(),
  free_delivery_value: nonNegativeNumber.optional(),
  require_location: z.boolean(),
  require_courier: z.boolean(),
  business_location_id: z
    .array(z.string().trim().min(1, "Ubicación requerida"))
    .optional(),
  options: z.array(CheckoutOptionSchema).max(100, "Demasiadas opciones").optional(),
  delivery_method_id: z.string().trim().min(1, "Método de entrega requerido"),
});

export type DeliveryInput = z.infer<typeof DeliverySchema>;
