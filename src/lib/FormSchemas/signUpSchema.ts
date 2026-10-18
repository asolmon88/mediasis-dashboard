import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js/min";

export const SignUpSchema = z.object({
  email: z.email(),

  // At least 8 characters and at least one UPPERCASE letter
  password: z
    .string()
    .min(8, "La contraseña debe ser de 8 caracteres")
    .regex(/[A-Z]/, "Debe incluir al menos una mayúscula"),

  // Business name — allow anything non-empty
  full_name: z.string().trim().min(1, "Nombre completo requerido"),

  // Short name for a location (e.g., "macdonalds", "starbucks plaza mayor")
  // Lowercase, numbers, spaces, hyphens and apostrophes; 2–60 chars
  short_name: z
    .string()
    .trim()
    .refine((s) => s.length >= 2 && s.length <= 60, {
      message: "Nombre corto debe ser de 2-60 caracteres",
    }),

  // Phone for the location — E.164 (+###########) preferred
  phone: z
    .string()
    .refine(isValidPhoneNumber, { message: "Invalid phone number" }),

  // Google Maps coordinates
  location: z.object({
    lat: z
      .number({ error: "Latitude is required" })
      .gte(-90, "Latitude must be ≥ -90")
      .lte(90, "Latitude must be ≤ 90"),
    lng: z
      .number({ error: "Longitude is required" })
      .gte(-180, "Longitude must be ≥ -180")
      .lte(180, "Longitude must be ≤ 180"),
  }),
});

export type SignUpInput = z.infer<typeof SignUpSchema>;
