"use client"

import * as React from "react"
import { CalendarDay } from "./CalendarDay"
import { Reservation } from "@/lib/types/dashboardTypes"
import { Dispatch, SetStateAction } from "react"
import { toYMDLocal } from "@/lib/ClientUtils"

interface CalendarGridProps {
  monthStart: Date
  weeks: Date[][]
  reservations: Reservation[] | undefined
  setCurrentDate: Dispatch<SetStateAction<Date>>
  setShowByType: Dispatch<SetStateAction<string>>
}

export function CalendarGrid({ monthStart, weeks, reservations, setCurrentDate, setShowByType }: CalendarGridProps) {
  return (
    <div className="flex-1 grid grid-cols-7 grid-rows-6 overflow-y-auto">
      {weeks.map((week, wi) =>
        week.map((day, di) => (
          <CalendarDay
            key={`${wi}-${di}`}
            day={day}
            monthStart={monthStart}
            reservations={reservations?.filter(
              (res) => toYMDLocal(res.date) === toYMDLocal(day)
            )}
            setCurrentDate={setCurrentDate}
            setShowByType={setShowByType}
          />
        ))
      )}
    </div>
  )
}
