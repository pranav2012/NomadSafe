// Unit labels come from our translations, not Intl's "unit" style: on iOS, Hermes silently re-converts
// those (km -> "6,923.939 mi", hours -> "28,800 sec").

export type UnitSystem = "metric" | "imperial";
export type TimeFormat = "12h" | "24h";

export interface UnitPrefs {
  temperature: "C" | "F";
  distance: "km" | "mi";
  rain: "mm" | "in";
}

export type UnitLabel = "km" | "m" | "mi" | "ft" | "mm" | "in" | "h" | "min";
export type LabelUnit = (unit: UnitLabel, value: string) => string;

const METRIC: UnitPrefs = { temperature: "C", distance: "km", rain: "mm" };
const IMPERIAL: UnitPrefs = { temperature: "F", distance: "mi", rain: "in" };
const KM_PER_MI = 1.609344;
const FT_PER_KM = 3280.84;
const MM_PER_IN = 25.4;

/** The phone's preferences: the UK keeps miles but °C and mm; the US is imperial throughout. */
export function deviceUnitPrefs(
  measurementSystem: "metric" | "us" | "uk" | null | undefined,
  temperatureUnit: "celsius" | "fahrenheit" | null | undefined,
): UnitPrefs {
  return {
    temperature: temperatureUnit ? (temperatureUnit === "fahrenheit" ? "F" : "C") : measurementSystem === "us" ? "F" : "C",
    distance: measurementSystem === "us" || measurementSystem === "uk" ? "mi" : "km",
    rain: measurementSystem === "us" ? "in" : "mm",
  };
}

export function resolveUnitPrefs(system: UnitSystem | null, device: UnitPrefs): UnitPrefs {
  return system === "metric" ? METRIC : system === "imperial" ? IMPERIAL : device;
}

export function formatNumber(value: number, locale: string, maxDigits = 0) {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: maxDigits }).format(value);
  } catch {
    return value.toFixed(maxDigits).replace(/\.?0+$/, "");
  }
}

export function toTemperature(celsius: number, unit: UnitPrefs["temperature"]) {
  return Math.round(unit === "F" ? (celsius * 9) / 5 + 32 : celsius);
}

/** "350 m" / "1.2 km" / "6,659 km", or "500 ft" / "0.8 mi" / "4,138 mi". */
export function formatDistance(km: number, unit: UnitPrefs["distance"], locale: string, label: LabelUnit) {
  if (unit === "km") {
    if (km < 1) return label("m", formatNumber(Math.max(10, Math.round(km * 100) * 10), locale));
    return label("km", formatNumber(km, locale, km < 10 ? 1 : 0));
  }
  const miles = km / KM_PER_MI;
  if (miles < 0.1) return label("ft", formatNumber(Math.max(10, Math.round((km * FT_PER_KM) / 10) * 10), locale));
  return label("mi", formatNumber(miles, locale, miles < 10 ? 1 : 0));
}

/** "4 mm" (whole millimetres) or "0.16 in". */
export function formatRain(mm: number, unit: UnitPrefs["rain"], locale: string, label: LabelUnit) {
  if (unit === "mm") return label("mm", formatNumber(Math.max(1, Math.round(mm)), locale));
  const inches = mm / MM_PER_IN;
  return label("in", formatNumber(Math.max(0.01, inches), locale, inches < 1 ? 2 : 1));
}

/** "~8 h 30 min", rounded to the quarter hour since the solar maths is only good to ~15 minutes. */
export function formatApproxDuration(hours: number, locale: string, label: LabelUnit) {
  const quarters = Math.max(1, Math.round(hours * 4));
  const h = Math.floor(quarters / 4);
  const m = (quarters % 4) * 15;
  const parts = [h > 0 ? label("h", formatNumber(h, locale)) : null, m > 0 ? label("min", formatNumber(m, locale)) : null];
  return `~${parts.filter(Boolean).join(" ")}`;
}

/** "12.3K": Intl's compact notation is missing on iOS Hermes. */
export function formatCompactNumber(value: number, locale: string) {
  const abs = Math.abs(value);
  if (abs < 1000) return formatNumber(value, locale);
  if (abs < 1_000_000) return `${formatNumber(value / 1000, locale, abs < 10_000 ? 1 : 0)}K`;
  return `${formatNumber(value / 1_000_000, locale, 1)}M`;
}

/** The clock to use: the user's pick, else the phone's setting, else the language's convention. */
export function uses12HourClock(format: TimeFormat | null, device24h: boolean | null | undefined, locale: string) {
  if (format) return format === "12h";
  if (device24h != null) return !device24h;
  try {
    return new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hour12 ?? false;
  } catch {
    return false;
  }
}
