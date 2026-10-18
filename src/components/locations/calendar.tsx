"use client"

import * as React from "react"
import { type DateRange } from "react-day-picker"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"

export default function CalendarLeftSide({date, setDate, dateRange, setDateRange, mode, setMode, bookedDates}:{
  date: Date | undefined,
  setDate: React.Dispatch<React.SetStateAction<Date | undefined>>,
  dateRange: DateRange | undefined,
  setDateRange: React.Dispatch<React.SetStateAction<DateRange | undefined>>,
  mode: React.ComponentProps<typeof Calendar>["mode"],
  setMode: React.Dispatch<React.SetStateAction<"single" | "multiple" | "range" | undefined>>,
  bookedDates: Date[]
}) {

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Label htmlFor="dropdown" className="px-1">
          ¿Desea seleccionar un día <br/>o un rango de días?
        </Label>
        <Select
          value={mode}
          onValueChange={(value) =>
            setMode(
              value as React.ComponentProps<typeof Calendar>["mode"]
            )
          }
        >
          <SelectTrigger
            id="dropdown"
            size="sm"
            className="bg-background w-full"
          >
            <SelectValue placeholder="dropdown" />
          </SelectTrigger>
          <SelectContent align="center">
            <SelectItem value="single">Un día</SelectItem>
            <SelectItem value="range">Rango de días</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(mode==='single') ? 
        (<Calendar
          mode="single"
          defaultMonth={date}
          selected={date}
          onSelect={setDate}
          disabled={bookedDates}
          captionLayout="dropdown"
          modifiers={{
            booked: bookedDates,
          }}
          startMonth={new Date(2025,0)}
          endMonth={new Date(2027,0)}
          modifiersClassNames={{
            booked: "[&>button]:line-through opacity-100",
          }}
          className="rounded-lg border shadow-sm"
        />) : (
          <Calendar
            mode="range"
            defaultMonth={dateRange?.from}
            selected={dateRange}
            onSelect={setDateRange}
            disabled={bookedDates}
            captionLayout="dropdown"
            modifiers={{
              booked: bookedDates,
            }}
            startMonth={new Date(2025,0)}
            modifiersClassNames={{
              booked: "[&>button]:line-through opacity-100",
            }}
            className="rounded-lg border shadow-sm"
          />
        )
      }
    </div>
  )
}
