"use client";

import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type GroupSizePickerProps = {
  value?: number | null;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  quickCount?: number; // how many quick buttons to show (default 10)
  className?: string;
};

export function GroupSizePicker({
  value,
  onChange,
  min = 1,
  max = 100,
  quickCount = 10,
  className,
}: GroupSizePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [temp, setTemp] = React.useState<number>(value ?? min);
  const [err, setErr] = React.useState<string>("");

  // keep temp synced when external value changes
  React.useEffect(() => {
    if (typeof value === "number") setTemp(value);
  }, [value]);

  const apply = (n: number) => {
    const clamped = Math.max(min, Math.min(max, Math.floor(n)));
    if (!Number.isFinite(clamped) || clamped < min || clamped > max) {
      setErr(`Ingresa un número entre ${min} y ${max}.`);
      return;
    }
    setErr("");
    onChange(clamped);
    setOpen(false);
  };

  const label =
    typeof value === "number" && value > 0
      ? `${value} ${value === 1 ? "persona" : "personas"}`
      : "Cantidad de personas";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn("w-[220px] justify-between", className)}
        >
          <span>{label}</span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="h-4 w-4 opacity-70"
            fill="none"
          >
            <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[260px] p-3">
        <div className="space-y-3">
          {/* Quick picks */}
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: quickCount }, (_, i) => i + 1).map((n) => (
              <Button
                key={n}
                type="button"
                variant={value === n ? "default" : "secondary"}
                className="h-9 w-9 p-0"
                onClick={() => apply(n)}
              >
                {n}
              </Button>
            ))}
          </div>

          {/* Custom input */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Otra cantidad</div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={Number.isFinite(temp) ? temp : ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setTemp(v);
                  if (!Number.isInteger(v) || v < min || v > max) {
                    setErr(`Ingresa un número entero entre ${min} y ${max}.`);
                  } else {
                    setErr("");
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    apply(Number(temp));
                  }
                }}
                className="w-[120px]"
                placeholder={`${min}-${max}`}
              />
              <Button
                type="button"
                onClick={() => apply(Number(temp))}
                className="shrink-0"
              >
                Aceptar
              </Button>
            </div>
            {err ? (
              <p className="text-xs text-red-600">{err}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Permite entre {min} y {max}.
              </p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
