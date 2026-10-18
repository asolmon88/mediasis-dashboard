import { z } from "zod";

export const ReservationSchema = z.object({
  group_size: z
    .number({
      error: "Debe ser un número",
    })
    .int("Debe ser un número entero")
    .positive("Debe ser mayor que 0"),

  date: z
    .date({
      error: "Fecha inválida",
    }),
  
    time: z
    .string({
      error: "Hora inválida"
    })
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Hora inválida (use formato 24h HH:MM)"),

  phone: z
    .string({
      error: "Número de teléfono es requerido",
    })
    .regex(/^\+?[1-9]\d{6,14}$/, "Número inválido"),

  first_name: z
    .string({
      error: "Nombre requerido",
    })
    .min(1, "Nombre requerido"),

  last_name: z
    .string({
      error: "Apellido requerido",
    })
    .min(1, "Apellido requerido"),
});

export type ReservationInput = z.infer<typeof ReservationSchema>;