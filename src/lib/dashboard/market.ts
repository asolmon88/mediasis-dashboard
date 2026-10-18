import type { BusinessMarket } from "@/lib/dashboard/auth-types";

export function formatMarketCurrency(
  value: number,
  market: BusinessMarket,
  options: Intl.NumberFormatOptions = {},
) {
  return new Intl.NumberFormat(market.locale, {
    style: "currency",
    currency: market.currencyCode,
    ...options,
  }).format(value);
}

export function formatMarketDateTime(
  value: string | Date,
  market: BusinessMarket,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" },
) {
  return new Intl.DateTimeFormat(market.locale, {
    ...options,
    timeZone: market.timezone,
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function hasMarketCapability(market: BusinessMarket, capability: string) {
  return market.capabilities.includes(capability);
}

export function marketDayBoundaryUtcIso(day: string, timeZone: string, nextDay = false) {
  const [year, month, date] = day.split("-").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, date + (nextDay ? 1 : 0));
  let candidate = desiredUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const observedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    candidate += desiredUtc - observedAsUtc;
  }
  return new Date(candidate).toISOString();
}

export function marketDayInclusiveEndUtcIso(day: string, timeZone: string) {
  const nextMidnight = new Date(marketDayBoundaryUtcIso(day, timeZone, true));
  return new Date(nextMidnight.getTime() - 1).toISOString();
}

export function marketDateKey(value: string | Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
