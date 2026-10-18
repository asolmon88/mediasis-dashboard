import { z } from "zod"

// Expect local JS Date objects from your Calendar
const LocalDate = z.date()

const ActiveDateRangeSchema = z.object({
  from: LocalDate,
  // For a single-day selection, leave `to` undefined.
  // For a range selection, set `to` (inclusive in UI).
  to: LocalDate.optional(),
})
.refine(
  (r) => !r.to || r.to >= r.from,
  { path: ["to"], message: "La fecha final debe ser igual o posterior a la inicial." }
)

// Optional special-hours window in minutes after midnight: [start, end)
const HoursSchema = z.object({
  start: z.number().int().min(0).max(1440).optional(),
  end:   z.number().int().min(0).max(1440).optional(),
})
.refine(
  (h) => (h.start == null && h.end == null) || (h.start != null && h.end != null && h.start < h.end),
  { path: ["end"], message: "Debes definir inicio y fin, y fin > inicio" }
)

export const ClosedSpecialDaySchema = z.object({
  active_daterange: ActiveDateRangeSchema,
  closed_all_day: z.boolean(),
  hours: HoursSchema.optional(),  // now safe, because start/end inside are optional
  note: z.string().trim().min(1, "La nota es obligatoria."),
})
.superRefine((val, ctx) => {
  // UX parity with backend rules: if it's closed all day, hours should not be present.
  if (val.closed_all_day && val.hours) {
    ctx.addIssue({
      code: 'custom',
      path: ["hours"],
      message: "No definas 'hours' cuando está cerrado todo el día.",
    })
  }
})

export type UIClosedSpecialDay = z.infer<typeof ClosedSpecialDaySchema>