'use server'

import type { OpenHours } from "@/lib/FormSchemas/openHoursSchema";
import { applyOpenHoursToLocations as applyReservationOpenHours } from "./actions";

export async function applyOpenHoursToLocations(input: {
  values: OpenHours;
  business_location_ids: string[];
  applyToAll: boolean;
  type?: "reservation";
}) {
  return applyReservationOpenHours(input);
}
