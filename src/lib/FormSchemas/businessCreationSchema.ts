import { isValidPhoneNumber } from "libphonenumber-js/min";
import { z } from "zod";

export const BusinessCreationSchema = z.object({
  full_name: z.string().trim().min(1, "Nombre del negocio requerido"),
  short_name: z.string().trim().min(2, "El nombre corto debe tener al menos 2 caracteres").max(60),
  phone: z.string().refine(isValidPhoneNumber, "Número de teléfono inválido"),
  location: z.object({
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
  }),
  countryCode: z.string().regex(/^[A-Z]{2}$/, "País inválido"),
  idempotencyKey: z.uuid(),
});

export type BusinessCreationInput = z.infer<typeof BusinessCreationSchema>;
