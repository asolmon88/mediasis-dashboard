import { z } from "zod";

export const ReservationEditSchema = z.object({
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
      error: "Hora inválida",
    })
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Hora inválida (formato HH:MM)"),

  status: z.enum(
    ["pending", "confirmed", "seated", "done", "cancelled"],
    {
      error: "Estado inválido",
    }
  ),
});

export type ReservationEditInput = z.infer<typeof ReservationEditSchema>;
