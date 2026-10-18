import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js/min";

export const LocationAddSchema = z.object({
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
