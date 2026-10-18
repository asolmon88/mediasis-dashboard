"use client";

import { useState } from "react";

export function HexColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const validHex = /^#[0-9a-fA-F]{6}$/;

  return <div className="relative inline-flex w-fit items-center gap-3 text-sm font-medium">
    <span>{label}</span>
    <button type="button" aria-label={`${label}: ${value}`} aria-expanded={open} onClick={() => { setDraft(value); setOpen(!open); }}
      className="h-10 w-10 shrink-0 rounded-full border-2 border-white shadow-[0_0_0_1px_#cbd5e1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      style={{ backgroundColor: value }} />
    {open ? <div className="absolute right-0 top-full z-20 mt-2 w-52 rounded-xl border bg-white p-3 shadow-lg">
      <label className="block text-xs text-slate-600">Color HEX
        <input type="text" inputMode="text" value={draft} maxLength={7} onChange={(event) => {
          const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
          setDraft(next);
          if (validHex.test(next)) onChange(next.toLowerCase());
        }} className="mt-1 w-full rounded-md border px-2 py-1.5 font-mono text-sm text-slate-950" />
      </label>
      <input type="color" aria-label={`Elegir ${label.toLowerCase()} en la paleta`} value={value} onChange={(event) => { setDraft(event.target.value); onChange(event.target.value); }} className="mt-3 h-9 w-full cursor-pointer" />
      <button type="button" onClick={() => setOpen(false)} className="mt-2 text-xs text-blue-600">Listo</button>
    </div> : null}
  </div>;
}
