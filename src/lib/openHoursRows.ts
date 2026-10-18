import { OpenHours } from "@/lib/FormSchemas/openHoursSchema";

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function buildWeekdayHours(values: OpenHours) {
  return values.weekdays.map((day, weekday) => ({
    weekday: weekday + 1,
    hours: day.hours.map(h => ({
      start: timeToMinutes(h.start),
      end: timeToMinutes(h.end),
    })),
  }));
}

export function buildOpenHoursRows(values: OpenHours, business_location_id: string) {
  return buildWeekdayHours(values).map(day => ({
    business_location_id,
    ...day,
  }));
}
