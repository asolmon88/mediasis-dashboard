import { useState } from "react";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { ChevronDownIcon } from "lucide-react";
import { Calendar } from "../ui/calendar";
import { Input } from "../ui/input";
import { ControllerRenderProps, FieldValues } from "react-hook-form";

export default function DateTimeFormField() {
  const [open, setOpen] = useState(false);
  return (
    <FormField
      name="date"
      render={({ field }) => (
        <DateTimeInnerField field={field} />
      )}
    />
  );
}

function DateTimeInnerField({ field }: { field: ControllerRenderProps<FieldValues, "date">}) {
  // ✅ now you can use hooks
  const [open, setOpen] = useState(false);
  const [timeStr, setTimeStr] = useState(() => formatTimeFromDate(field.value));

  const parseTime = (s: string) => {
    // supports "HH:mm" or "HH:mm:ss"
    const [h = "0", m = "0", sec = "0"] = s.split(":");
    return {
      h: clampInt(+h, 0, 23),
      m: clampInt(+m, 0, 59),
      s: clampInt(+sec, 0, 59),
    };
  };

  const applyTime = (base: Date, s: string) => {
    const d = new Date(base);
    const { h, m, s: sec } = parseTime(s);
    d.setHours(h, m, sec, 0);
    return d;
  };

  const applyDate = (base: Date, picked: Date) => {
    const d = new Date(base);
    d.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    return d;
  };

  const onCalendarSelect = (picked?: Date) => {
    if (!picked) return;
    const next = applyDate(field.value, picked);
    field.onChange(next);
    setOpen(false);
  };

  const onTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTimeStr(val);
    const next = applyTime(field.value, val);
    field.onChange(next);
  };

  return (
    <FormItem>
      <FormLabel>Fecha</FormLabel>
      <FormControl>
        <div className="flex gap-4">
          {/* Calendar popover */}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-56 justify-between font-normal">
                {field.value.toLocaleDateString("es-ES", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                {formatTimeFromDate(field.value)}
                <ChevronDownIcon className="ml-2 h-4 w-4 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              <Calendar
                mode="single"
                required
                selected={field.value}
                captionLayout="dropdown"
                onSelect={onCalendarSelect}
                className="rounded-lg border"
              />
            </PopoverContent>
          </Popover>

          {/* Time input */}
          <div className="flex flex-col gap-2">
            <FormLabel htmlFor="time-picker" className="px-1">
              Hora
            </FormLabel>
            <Input
              type="time"
              id="time-picker"
              step={60}
              value={timeStr}
              onChange={onTimeChange}
              className="bg-background w-32"
            />
          </div>
        </div>
      </FormControl>
      <FormDescription>
        Selecciona el día y la hora. Guardamos ambos en un solo campo `Date`.
      </FormDescription>
      <FormMessage />
    </FormItem>
  );
}

function formatTimeFromDate(d: Date) {
  // returns "HH:mm" in local time
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  // if you want seconds: add const ss = String(d.getSeconds()).padStart(2,"0"); and return `${hh}:${mm}:${ss}`
  return `${hh}:${mm}`;
}

function clampInt(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}