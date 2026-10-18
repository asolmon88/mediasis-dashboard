"use client";

import { useState } from "react";
import { CalendarDays, CircleHelp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function parseDateTime(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hour && date.getMinutes() === minute
    ? date
    : null;
}

function formatDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function DateTimePicker({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateTime(value);

  return (
    <Field>
      <FieldLabel htmlFor={`${id}-date`}>{label}</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button id={`${id}-date`} type="button" variant="outline" className="min-w-44 justify-between font-normal">
              {selected ? selected.toLocaleDateString("es-CR") : "Seleccionar fecha"}
              <CalendarDays className="size-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={selected ?? undefined}
              onSelect={(date) => {
                if (!date) return;
                const next = selected ? new Date(selected) : new Date();
                next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                onChange(formatDateTime(next));
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Input
          id={`${id}-time`}
          type="time"
          aria-label={`Hora de ${label.toLowerCase()}`}
          className="w-32"
          value={selected ? value.slice(-5) : ""}
          onChange={(event) => {
            const base = selected ? new Date(selected) : new Date();
            const [hours, minutes] = event.target.value.split(":").map(Number);
            if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
            base.setHours(hours, minutes, 0, 0);
            onChange(formatDateTime(base));
          }}
        />
      </div>
    </Field>
  );
}

type ActiveBlockProps = {
  startDate: string;
  onStartDateChange: (value: string) => void;
  hasEndDate: boolean;
  onHasEndDateChange: (checked: boolean) => void;
  endDate: string;
  onEndDateChange: (value: string) => void;
};

export default function ActiveBlock({
  startDate,
  onStartDateChange,
  hasEndDate,
  onHasEndDateChange,
  endDate,
  onEndDateChange,
}: ActiveBlockProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Fechas activas
          <CircleHelp className="h-5 w-5 text-muted-foreground" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <DateTimePicker id="discount-start" label="Fecha de inicio" value={startDate} onChange={onStartDateChange} />

        <div className="flex items-center gap-2.5 text-left">
          <Checkbox
            checked={hasEndDate}
            onCheckedChange={(value) => onHasEndDateChange(Boolean(value))}
            className="size-5"
          />
          <button
            type="button"
            onClick={() => onHasEndDateChange(!hasEndDate)}
            className="text-sm font-medium text-left"
          >
            Definir fecha de finalización
          </button>
        </div>

        {hasEndDate ? (
          <DateTimePicker id="discount-end" label="Fecha de finalización" value={endDate} onChange={onEndDateChange} />
        ) : null}
      </CardContent>
    </Card>
  );
}
