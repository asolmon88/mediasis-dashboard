"use client"

import CalendarLeftSide from "@/components/locations/calendar";
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area";
import React from "react";
import { DateRange } from "react-day-picker";
import { ClosedSpecialForm } from "@/components/locations/ClosedSpecialForm";
import {  UIClosedSpecialDay } from "@/lib/FormSchemas/closedSpecialDaySchema";
import ClosedDayEntry from "./ClosedDayEntry";
import { addDays } from "@/lib/utils";

export default function ClosedDaysPageLayout({
  currentClosedSpecialDays = [],
  loadingClosedSpecialDays,
  type = 'reservation',
  onChanged,
}:{
  currentClosedSpecialDays?: UIClosedSpecialDay[],
  loadingClosedSpecialDays: boolean,
  type?: 'orders' | 'reservation',
  onChanged?: () => void,
}) {

  const [date, setDate] = React.useState<Date | undefined>(
    undefined
  )
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>({
    from: undefined,
    to: undefined,
  })
  const [mode, setMode] =
    React.useState<React.ComponentProps<typeof Calendar>["mode"]>(
      "single"
    )
  const bookedDates = React.useMemo(() => {
    const dates: Date[] = []
    for (const day of currentClosedSpecialDays ?? []) {
      const start = day.active_daterange.from
      const end   = day.active_daterange.to ?? day.active_daterange.from

      for (let dt = new Date(start); dt <= end; dt = addDays(dt, 1)) {
        dates.push(new Date(dt))
      }
    }
    return dates
  }, [currentClosedSpecialDays])

  const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

  const today = atMidnight(new Date())

  const hasActiveSelection =
    mode === "single"
      ? !!date
      : (!!dateRange?.from && !!dateRange?.to)

  return (
    <div className="flex flex-col space-y-2 max-w-svw justify-center items-center p-4 lg:flex-row">
      <div className="flex flex-col space-y-2 lg:flex-row lg:space-x-2 lg:w-full">
        <Card className="lg:w-2/3">
          <CardHeader>
            <CardTitle>Calendario</CardTitle>
          </CardHeader>
          <CardContent className="lg:flex lg:justify-center lg:items-center flex-col space-y-2">
            <CalendarLeftSide date={date} setDate={setDate} dateRange={dateRange} setDateRange={setDateRange} mode={mode} setMode={setMode} bookedDates={bookedDates}/>
            <AnimatePresence>
              {hasActiveSelection && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.25 }}
                >
                  <ClosedSpecialForm active_daterange={mode === 'single' ? {from: date} : {from:dateRange?.from, to:dateRange?.to}} type={type} onChanged={onChanged}/>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
        <Card className="lg:w-1/3">
          <CardHeader>
            <CardTitle>Agendados</CardTitle>
            <CardDescription>Cierres y días especiales agendados</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[350px]">
              {(!currentClosedSpecialDays || currentClosedSpecialDays.length === 0) ? (
                <p className="text-sm">No hay fechas de cierre ni especiales.</p>
              ) : (
                currentClosedSpecialDays
                  .filter((day) => {
                    const from = atMidnight(day.active_daterange.from)
                    const to = day.active_daterange.to ? atMidnight(day.active_daterange.to) : from
                    // show if today is inside the range OR the range is in the future
                    return to >= today
                  })
                  .map((day, idx) => (
                    <ClosedDayEntry
                      key={idx}
                      active_daterange={day.active_daterange}
                      closed_all_day={day.closed_all_day}
                      hours={day.hours}
                      note={day.note}
                      type={type}
                      onChanged={onChanged}
                    />
                  ))
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// TODO add to show past dates
