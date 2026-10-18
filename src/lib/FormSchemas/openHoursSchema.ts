import { z } from "zod";

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

// Start allows 00:00..23:59
export const TimeHHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24h HH:mm"); // e.g., "09:30", "16:05"

// End allows 00:00..24:00 (only exact 24:00 as the 24th hour)
export const TimeHHMMEnd = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, "Use 24h HH:mm");

export const TimeWindowSchema = z.object({
  start: TimeHHMM,
  end: TimeHHMMEnd,
}).superRefine((tw, ctx) => {
  if (toMinutes(tw.end) <= toMinutes(tw.start)) {
    ctx.addIssue({
      code: 'custom',
      path: ["end"],
      message: "El final debe estar antes del incio",
    });
  }
});

const DayHoursSchema = (weekday: 1|2|3|4|5|6|7) => z.object({
  weekday: z.literal(weekday),
  hours: z.array(TimeWindowSchema).superRefine((list, ctx) => {
    // ensure no overlaps
    const sorted = [...list].sort((a,b)=>toMinutes(a.start)-toMinutes(b.start));
    for (let i=1;i<sorted.length;i++){
      const prev = sorted[i-1], cur = sorted[i];
      if (toMinutes(cur.start) < toMinutes(prev.end)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Las ventanas de apertura no pueden chocar',
        });
        break;
      }
    }
  }),
});

export const WeekDaysSchema = z.tuple([
  DayHoursSchema(1),
  DayHoursSchema(2),
  DayHoursSchema(3),
  DayHoursSchema(4),
  DayHoursSchema(5),
  DayHoursSchema(6),
  DayHoursSchema(7),
]);

export const OpenHoursSchema = z
  .object({
    weekdays: WeekDaysSchema
  })

export type OpenHours = z.infer<typeof OpenHoursSchema>;
