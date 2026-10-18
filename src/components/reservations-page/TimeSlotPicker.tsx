"use client";

import * as React from "react";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

type Window = { start: string; end: string };

type TimeSlotPickerProps = {
  /** Current time as "HH:MM" (24h), e.g. "09:30" */
  value?: string;
  /** Called with the new "HH:MM" string */
  onChange: (next: string) => void;
  /** Optional range and step (used when no openWindows are provided) */
  startHour?: number;   // default 9
  endHour?: number;     // default 22 (inclusive at :00)
  stepMinutes?: number; // default 30
  /** If provided, restrict slots to these open windows for the selected weekday */
  openWindows?: Window[]; // e.g. [{start:"09:00", end:"13:00"}, {start:"14:00", end:"18:00"}]
};

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function fmtHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function roundUpToStep(mins: number, step: number): number {
  const rem = mins % step;
  return rem === 0 ? mins : mins + (step - rem);
}

export function TimeSlotPicker({
  value,
  onChange,
  startHour = 9,
  endHour = 22,
  stepMinutes = 30,
  openWindows,
}: TimeSlotPickerProps) {
  const slots = React.useMemo(() => {
    // No windows: keep original behavior
    if (!openWindows || openWindows.length === 0) {
      const out: string[] = [];
      for (let h = startHour; h <= endHour; h++) {
        for (let m = 0; m < 60; m += stepMinutes) {
          if (h === endHour && m > 0) break; // endHour only includes :00
          out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
        }
      }
      return out;
    }

    // With windows: generate by ranges
    const seen = new Set<string>();
    for (const w of openWindows) {
      const startM = parseHHMM(w.start);
      const endM = parseHHMM(w.end);

      if (
        Number.isNaN(startM) ||
        Number.isNaN(endM) ||
        startM < 0 ||
        endM > 24 * 60 ||
        startM >= endM
      ) {
        continue; // skip malformed
      }

      // Start from the first slot >= start
      let t = roundUpToStep(startM, stepMinutes);

      // Add slots < end
      while (t < endM) {
        seen.add(fmtHHMM(t));
        t += stepMinutes;
      }

      // If end aligns to step, include the exact end (like current endHour :00 rule)
      if (endM % stepMinutes === 0) {
        seen.add(fmtHHMM(endM));
      }
    }

    // Return sorted list
    return Array.from(seen)
      .map((s) => [s, parseHHMM(s)] as const)
      .sort((a, b) => a[1] - b[1])
      .map(([s]) => s);
  }, [openWindows, startHour, endHour, stepMinutes]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-auto">
        <SelectValue placeholder="Seleccionar hora" />
      </SelectTrigger>
      <SelectContent>
        {slots.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}