"use client";

import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DecimalMoneyInputProps = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "inputMode" | "type"> & {
  value: number | string | null | undefined;
  onChange: (value: number) => void;
};

export function DecimalMoneyInput({ value, onChange, className, onBlur, onFocus, ...props }: DecimalMoneyInputProps) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value == null ? "" : String(value));
  }, [value]);

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={draft}
      className={cn("[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none", className)}
      onFocus={(event) => {
        focused.current = true;
        onFocus?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        if (!/^\d*(?:[.,]\d*)?$/.test(raw)) return;
        setDraft(raw);
        const normalized = raw.replace(",", ".");
        if (normalized !== "" && !normalized.endsWith(".")) {
          const parsed = Number(normalized);
          if (Number.isFinite(parsed)) onChange(parsed);
        }
      }}
      onBlur={(event) => {
        focused.current = false;
        const normalized = draft.replace(",", ".");
        const parsed = Number(normalized);
        const committed = normalized === "" || !Number.isFinite(parsed) ? 0 : parsed;
        setDraft(String(committed));
        onChange(committed);
        onBlur?.(event);
      }}
    />
  );
}
