'use server'

import { ClosedSpecialDaySchema } from "@/lib/FormSchemas/closedSpecialDaySchema";
import { createClient } from "@/lib/supabase/server";
import { PostgrestError } from "@supabase/supabase-js";
import z from "zod";

function addDays(d: Date, days: number) {
  const nd = new Date(d)
  nd.setDate(nd.getDate() + days)
  return nd
}

function ymdLocal(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export async function upsertClosedDays(values: z.infer<typeof ClosedSpecialDaySchema>, business_location:string) {
  const supabase = await createClient();
  const from = values.active_daterange.from
  const toInclusive = values.active_daterange.to ?? values.active_daterange.from
  const toExclusive = addDays(toInclusive, 1)

  const active_daterange = `[${ymdLocal(from)},${ymdLocal(toExclusive)})` // daterange

  // --- Transform hours (minutes) into int4range literal or null ---
  const hours =
    values.closed_all_day
      ? null
      : values.hours && values.hours.start != null && values.hours.end != null
        ? `[${values.hours.start},${values.hours.end})`
        : null

  try {
    const { data: user, error: userError } = await supabase.auth.getUser()
    if (userError) throw userError;
    const business_uid = user.user?.id

    const payload = {
      business_uid,
      location: business_location,
      active_daterange,          // e.g. "[2025-12-24,2025-12-25)"
      closed_all_day: values.closed_all_day,
      hours,                     // e.g. "[540,780)" or null
      note: values.note.trim(),
    }

    const { error } = await supabase
      .schema("mediasis")
      .from("business_location_special_closed_days")
      .upsert(payload, { onConflict: "business_uid,location,active_daterange" })

    if (error) throw error
    return { success: true }
  } catch (error) {
    const message =
      error instanceof PostgrestError
        ? error.message
        : error instanceof Error
        ? error.message
        : "Ocurrió un error";
    return { success: false, message}
  }
}

export async function deleteClosedDay(
  location: string,
  active_daterange_input: {
    from: Date;
    to?: Date | undefined;
  }, 
) {
  const supabase = await createClient()
  try {
    const { data: user, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError;
      const business_uid = user.user?.id
    const active_daterange =
    typeof active_daterange_input === "string"
      ? active_daterange_input
      : (() => {
          const from = active_daterange_input.from
          const toInc = active_daterange_input.to ?? active_daterange_input.from
          const toExc = addDays(toInc, 1)
          return `[${ymdLocal(from)},${ymdLocal(toExc)})`
        })()
  
    const { error } = await supabase
      .schema("mediasis")
      .from("business_location_special_closed_days")
      .delete()
      .eq("business_uid", business_uid)
      .eq("location", location)
      .eq("active_daterange", active_daterange)
  
    if (error) throw error
  } catch (error) {
    const message =
      error instanceof PostgrestError
        ? error.message
        : error instanceof Error
        ? error.message
        : "Ocurrió un error";
    return { success: false, message}
  }

  return { success: true }
}
