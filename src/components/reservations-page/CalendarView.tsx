"use client"

import * as React from "react"
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, format } from "date-fns"
import { CalendarGrid } from "./CalendarGrid"
import { Reservation } from "@/lib/types/dashboardTypes"
import { Dispatch, SetStateAction } from "react"

interface CalendarViewProps {
  date: Date,
  reservations: Reservation[] | undefined,
  setCurrentDate: Dispatch<SetStateAction<Date>>
  setShowByType: Dispatch<SetStateAction<string>>
}

export function CalendarView({ date, reservations, setCurrentDate, setShowByType }: CalendarViewProps) {
  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 }) // Sunday
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 })

  const days: Date[] = []
  let day = startDate
  while (day <= endDate) {
    days.push(day)
    day = addDays(day, 1)
  }

  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  return (
    <div className="w-full h-svh flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-2">
        <h2 className="text-lg font-semibold capitalize">
          {format(monthStart, "MMMM yyyy")}
        </h2>
      </div>

      {/* Day names */}
      <div className="grid grid-cols-7 border-b border-border text-center text-sm font-medium text-muted-foreground select-none">
        {["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"].map((day) => (
          <div key={day} className="py-2 uppercase tracking-wide">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar body */}
      <CalendarGrid monthStart={monthStart} weeks={weeks} reservations={reservations} setCurrentDate={setCurrentDate} setShowByType={setShowByType}/>
    </div>
  )
}

