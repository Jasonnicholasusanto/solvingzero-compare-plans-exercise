const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

const audWhole = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const decimal = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });

/**
 * en-GB, not en-AU: both render D MMM YYYY, but en-AU's CLDR data leaves June and July
 * unabbreviated, so a range would read "7 Aug 2025 – 20 June 2026".
 */
const day = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "$1,474.30" — use where the exact cents matter (line items, reconciliation). */
export function money(value: number | null | undefined): string {
  return value == null ? "—" : aud.format(value);
}

/** "$1,474" — use for headline figures, where cents are noise. */
export function moneyWhole(value: number | null | undefined): string {
  return value == null ? "—" : audWhole.format(value);
}

/** Signed, for deltas: a credit reads "−$412.90", a charge "+$1,284.46". */
export function moneySigned(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value < 0 ? "−" : "+"}${aud.format(Math.abs(value))}`;
}

export function percent(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

export function kwh(value: number | null | undefined): string {
  return value == null ? "—" : `${decimal.format(value)} kWh`;
}

/** ISO date (or CDR datetime) to "7 Aug 2025". Returns "—" for anything unparseable. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : day.format(parsed);
}

export function dateRange(from: string | null | undefined, to: string | null | undefined): string {
  return `${shortDate(from)} – ${shortDate(to)}`;
}

/**
 * Turns the engine's band keys (`PEAK`, `OFF_PEAK`, `SHOULDER`, …) into prose.
 * Unknown bands fall through to title case rather than being dropped.
 */
export function bandLabel(band: string): string {
  return band
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
