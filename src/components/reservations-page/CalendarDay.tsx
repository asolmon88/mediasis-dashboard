"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { format, isSameMonth, isToday } from "date-fns"
import { Badge } from "../ui/badge"
import { Reservation } from "@/lib/types/dashboardTypes"
import { Dispatch, SetStateAction } from "react"

interface CalendarDayProps {
  day: Date
  monthStart: Date
  reservations?: Reservation[];
  setCurrentDate: Dispatch<SetStateAction<Date>>
  setShowByType: Dispatch<SetStateAction<string>>
}

export function CalendarDay({ day, monthStart, reservations, setCurrentDate, setShowByType }: CalendarDayProps) {
  const isCurrentMonth = isSameMonth(day, monthStart)
  const pendingCount = reservations?.filter(r => r.status === "pending").length ?? 0;
  const confirmedCount = reservations?.filter(r => r.status === "confirmed").length ?? 0;

  const handleSelect = () => {
    setCurrentDate(new Date(day))
    setShowByType('Fecha');
  };

  return (
    <div
      role="button"
      onClick={handleSelect}
      className={cn(
        "relative border border-border p-1 sm:p-2 flex flex-col overflow-hidden hover:bg-accent transition min-h-max",
        !isCurrentMonth && "opacity-40 bg-muted/30",
        isToday(day) && "border-primary border-2"
      )}
    >
      {/* Header */}
      <div className="flex justify-between items-start">
        <span className="text-xs font-semibold text-muted-foreground">
          {format(day, "d")}
        </span>
      </div>

      <div className="mt-1 flex flex-col gap-1 text-[0.7rem] text-muted-foreground overflow-x-hidden">
        {(pendingCount > 0 || confirmedCount > 0) && (
          <>
            {pendingCount > 0 && (
              <Badge variant="default" className="bg-orange-400">
                {pendingCount} {pendingCount === 1 ? "pendiente" : "pendientes"}
              </Badge>
            )}
            {confirmedCount > 0 && (
              <Badge variant="default" className="bg-sky-500">
                {confirmedCount} {confirmedCount === 1 ? "confirmada" : "confirmadas"}
              </Badge>
            )}
          </>
        )}
      </div>
    </div>
  )
}
