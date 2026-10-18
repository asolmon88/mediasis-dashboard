import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { ReservationInput } from "./FormSchemas/reservationSchema";
import { ReservationEditFormValues, ReservationFormValues } from "./types/dashboardTypes";
import { ReservationEditInput } from "./FormSchemas/reseravtionEditSchema";
import { UIClosedSpecialDay } from "./FormSchemas/closedSpecialDaySchema";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toReservationFormValues(values: ReservationInput): ReservationFormValues {
  const [hh, mm] = values.time.split(":").map(Number);

  // clone the date and apply time in local browser tz
  const combined = new Date(values.date);
  combined.setHours(hh, mm, 0, 0);

  // convert to UTC instant (keep as Date)
  const utcDate = new Date(combined.getTime());

  return {
    group_size: values.group_size,
    date: utcDate,
    phone: values.phone,
    first_name: values.first_name,
    last_name: values.last_name,
  };
}

export function toReservationEditFormValues(values: ReservationEditInput): ReservationEditFormValues {
  const [hh, mm] = values.time.split(":").map(Number);

  // clone the date and apply time in local browser tz
  const combined = new Date(values.date);
  combined.setHours(hh, mm, 0, 0);

  // convert to UTC instant
  const utcDate = new Date(combined.getTime());

  return {
    group_size: values.group_size,
    date: utcDate,
    status: values.status,
  };
}

export function timeToMinutes(time: string | undefined): number | undefined{
  if (!time) return undefined;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(total: number | undefined): string | undefined {
  if (typeof total !== "number" || !Number.isFinite(total)) return undefined;
  const h = Math.floor(total / 60).toString().padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function minutesToIntervalLiteral(minutes: number): string {
  const safeMinutes = Number.isFinite(minutes)
    ? Math.max(1, Math.min(180, Math.round(minutes)))
    : 5;
  return `${safeMinutes} minutes`;
}

export function intervalToMinutes(
  interval: string | null | undefined,
  fallback = 5
): number {
  if (!interval || typeof interval !== "string") return fallback;

  const hhmmss = interval.match(/^(-?\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/);
  if (hhmmss) {
    const hours = Number(hhmmss[1]);
    const minutes = Number(hhmmss[2]);
    const seconds = Number(hhmmss[3]);
    if ([hours, minutes, seconds].some(Number.isNaN)) return fallback;
    const total = Math.round(hours * 60 + minutes + seconds / 60);
    if (!Number.isFinite(total)) return fallback;
    return Math.max(1, Math.min(180, total));
  }

  const verbose = interval.match(
    /(?:(-?\d+)\s+day[s]?)?\s*(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)/
  );
  if (verbose) {
    const days = Number(verbose[1] ?? 0);
    const hours = Number(verbose[2]);
    const minutes = Number(verbose[3]);
    const seconds = Number(verbose[4]);
    if ([days, hours, minutes, seconds].some(Number.isNaN)) return fallback;
    const total = Math.round(days * 24 * 60 + hours * 60 + minutes + seconds / 60);
    if (!Number.isFinite(total)) return fallback;
    return Math.max(1, Math.min(180, total));
  }

  const plainMinutes = Number(interval);
  if (Number.isFinite(plainMinutes)) {
    return Math.max(1, Math.min(180, Math.round(plainMinutes)));
  }

  console.warn(`Invalid interval format received for pickup_ready_offset: "${interval}"`);
  return fallback;
}

export function formatMinutesHuman(minutes: number): string {
  const safeMinutes = Number.isFinite(minutes)
    ? Math.max(1, Math.min(180, Math.round(minutes)))
    : 5;
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

/**
 * Deserialize closed special day data coming from database
 * 
 */

// --- helpers: local date parsing & math (no TZ shifts) ---
const parseYMDLocal = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d) // local midnight
}
export const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
const sameYMD = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

// --- parse Postgres daterange literal "[YYYY-MM-DD,YYYY-MM-DD)" to UI range ---
function parseDateRangeLiteral(lit: string): { from: Date; to?: Date } {
  // assume format like "[2025-09-17,2025-09-18)" with exclusive upper bound
  const m = lit.match(/^[\[\(]([^,]+),([^\)\]]+)[\)\]]$/)
  if (!m) throw new Error(`Invalid daterange literal: ${lit}`)
  const from = parseYMDLocal(m[1])
  const upperExclusive = parseYMDLocal(m[2])

  // If upper = from + 1 day, it's a single day → UI { from, to: undefined }
  const expectedNext = addDays(from, 1)
  if (sameYMD(upperExclusive, expectedNext)) {
    return { from }
  }
  // Multi-day selection in UI is inclusive; convert exclusive upper to inclusive
  const toInclusive = addDays(upperExclusive, -1)
  return { from, to: toInclusive }
}

// --- parse int4range literal "[start,end)" to minutes ---
function parseInt4RangeLiteral(lit: string | null): { start: number; end: number } | undefined {
  if (!lit) return undefined
  const m = lit.match(/^[\[\(](\d+),(\d+)[\)\]]$/)
  if (!m) return undefined
  const start = Number(m[1])
  const end = Number(m[2])
  return { start, end }
}

// --- main transformer ---
export function deserializeClosedSpecialDay(row: {
  active_daterange: string
  closed_all_day: boolean
  note: string
  hours: string | null
}): UIClosedSpecialDay {
  return {
    active_daterange: parseDateRangeLiteral(row.active_daterange),
    closed_all_day: row.closed_all_day,
    hours: row.closed_all_day ? undefined : parseInt4RangeLiteral(row.hours),
    note: row.note ?? "",
  }
}

export function normalizePath(path: string) {
  if (!path.startsWith("/")) return `/${path}`
  return path
}

export type MoneyFormatter = (value: number) => string;

type OrderOptionValue =
  | { price?: number; choice?: string }
  | Array<{ price?: number; choice?: string }>
  | string
  | null;

type OrderOption = {
  type: "short_answer" | "select" | "checkbox" | "text" | "media";
  question?: string;
  value?: OrderOptionValue;
  text?: string;
};

const formatChoice = (choice: string | undefined, price: number | undefined, formatMoney: MoneyFormatter) => {
  if (!choice) return "";
  if (typeof price === "number" && Number.isFinite(price) && price > 0) {
    return `${choice} (${formatMoney(price)})`;
  }
  return choice;
};

const formatChoiceWithQuantity = (choice: string | undefined, price: number | undefined, quantity: number | undefined, formatMoney: MoneyFormatter) => {
  const formattedChoice = formatChoice(choice, price, formatMoney);
  if (!formattedChoice) return "";

  const safeQuantity =
    typeof quantity === "number" && Number.isFinite(quantity) ? quantity : null;

  if (safeQuantity && safeQuantity > 1) {
    return `${formattedChoice} (${safeQuantity})`;
  }

  return formattedChoice;
};

export type OrderOptionDisplay =
  | {
      type: "text";
      label: string;
      value: string;
    }
  | {
      type: "media";
      label: string;
      mediaUrl: string;
    };

export const formatOrderOptions = (options: unknown, formatMoney: MoneyFormatter): OrderOptionDisplay[] => {
  if (!Array.isArray(options)) return [];

  return options
    .filter((option) => option && typeof option === "object")
    .map((option) => option as OrderOption)
    .filter((option) => option.type !== "text")
    .map((option) => {
      const question = option.question ?? "Opcion";
      if (option.type === "short_answer" && typeof option.value === "string") {
        const value = option.value.trim();
        if (!value) return null;
        return { type: "text", label: question, value };
      }

      if (option.type === "select" && option.value && typeof option.value === "object") {
        const value = option.value as { price?: number; choice?: string };
        const formattedChoice = formatChoice(value.choice, value.price, formatMoney);
        if (!formattedChoice) return null;
        return { type: "text", label: question, value: formattedChoice };
      }

      if (option.type === "checkbox" && Array.isArray(option.value)) {
        const choices = option.value
          .map((choice) => formatChoice(choice.choice, choice.price, formatMoney))
          .filter(Boolean)
          .join(", ");
        if (!choices) return null;
        return { type: "text", label: question, value: choices };
      }

      if (option.type === "media" && typeof option.value === "string") {
        return { type: "media", label: question, mediaUrl: option.value };
      }

      return null;
    })
    .filter((option): option is OrderOptionDisplay => Boolean(option));
};

type ProductOptionGroup = {
  name: string;
  choices: Array<{ price?: number; choice?: string; quantity?: number }>;
};

type ProductTextOption = {
  name?: string;
  value?: string;
};

type ProductOptions = {
  checkbox?: ProductOptionGroup[];
  selection?: Array<{ name: string; choice?: { price?: number; choice?: string } }>;
  text?: ProductTextOption[];
};

export const calculateRealtimeItemLineTotal = (
  unitPrice: number | null | undefined,
  quantity: number | null | undefined,
  options: unknown
) => {
  const safeUnitPrice =
    typeof unitPrice === "number" && Number.isFinite(unitPrice) ? unitPrice : 0;
  const safeQuantity =
    typeof quantity === "number" && Number.isFinite(quantity) ? Math.max(0, quantity) : 0;

  if (!options || typeof options !== "object") {
    return safeUnitPrice * safeQuantity;
  }

  const data = options as ProductOptions;
  const checkboxGroups = Array.isArray(data.checkbox) ? data.checkbox : [];
  const selectionGroups = Array.isArray(data.selection) ? data.selection : [];

  const checkboxSurcharge = checkboxGroups.reduce((total, group) => {
    const groupTotal = group.choices.reduce((groupSum, choice) => {
      const price =
        typeof choice.price === "number" && Number.isFinite(choice.price) ? choice.price : 0;
      return groupSum + price;
    }, 0);
    return total + groupTotal;
  }, 0);

  const selectionSurcharge = selectionGroups.reduce((total, group) => {
    const price =
      typeof group.choice?.price === "number" && Number.isFinite(group.choice.price)
        ? group.choice.price
        : 0;
    return total + price;
  }, 0);

  return (safeUnitPrice + checkboxSurcharge + selectionSurcharge) * safeQuantity;
};

export type ProductOptionDisplay = {
  label: string;
  values: string[];
  displayAsBullets: boolean;
};

export const formatProductOptions = (options: unknown, formatMoney: MoneyFormatter): ProductOptionDisplay[] => {
  if (!options || typeof options !== "object") return [];
  const data = options as ProductOptions;
  const checkboxGroups = Array.isArray(data.checkbox) ? data.checkbox : [];
  const selectionGroups = Array.isArray(data.selection) ? data.selection : [];
  const textGroups = Array.isArray(data.text) ? data.text : [];

  const checkboxLines = checkboxGroups
    .map((group) => {
      const choices = group.choices
        .map((choice) => formatChoiceWithQuantity(choice.choice, choice.price, choice.quantity, formatMoney))
        .filter((choice): choice is string => Boolean(choice));
      if (choices.length === 0) return null;
      return { label: group.name, values: choices, displayAsBullets: true };
    })
    .filter((line): line is ProductOptionDisplay => Boolean(line));

  const selectionLines = selectionGroups
    .map((group) => {
      if (!group.choice) return "";
      const value = formatChoice(group.choice.choice, group.choice.price, formatMoney);
      if (!value) return null;
      return { label: group.name, values: [value], displayAsBullets: true };
    })
    .filter((line): line is ProductOptionDisplay => Boolean(line));

  const textLines = textGroups
    .map((entry) => {
      const value = typeof entry.value === "string" ? entry.value.trim() : "";
      if (!value) return null;
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      return { label: name || "Opcion", values: [value], displayAsBullets: false };
    })
    .filter((line): line is ProductOptionDisplay => Boolean(line));

  return [...selectionLines, ...checkboxLines, ...textLines];
};

export const formatCurrencyValue = (value: number | null | undefined, formatMoney: MoneyFormatter) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return formatMoney(value);
};

export const normalizeExternalUrl = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`);
      return parsed.toString();
    } catch {
      return null;
    }
  }
};

export type StoragePath = { bucket: string; path: string };

export function parseStorageUrl(url: string): StoragePath | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/,
    );
    if (!match) return null;
    return { bucket: match[1], path: match[2] };
  } catch {
    return null;
  }
}
