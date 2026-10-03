function formatUnit(value: number, unit: "kilometer" | "meter" | "hour" | "minute", locale: string, digits = 0) {
  try {
    return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow", maximumFractionDigits: digits }).format(value);
  } catch {
    const suffix = { kilometer: "km", meter: "m", hour: "h", minute: "m" }[unit];
    return `${value.toFixed(digits)}${unit === "kilometer" || unit === "meter" ? " " : ""}${suffix}`;
  }
}

/** "350 m" / "1.2 km" / "6,659 km" in the user's locale. */
export function formatDistance(km: number, locale: string) {
  if (km < 1) return formatUnit(Math.round(km * 100) * 10, "meter", locale);
  return formatUnit(km, "kilometer", locale, km < 10 ? 1 : 0);
}

/** "~8h 30m", rounded to the quarter hour since the solar maths is only good to ~15 minutes. */
export function formatApproxDuration(hours: number, locale: string) {
  const quarters = Math.max(1, Math.round(hours * 4));
  const h = Math.floor(quarters / 4);
  const m = (quarters % 4) * 15;
  const parts = [h > 0 ? formatUnit(h, "hour", locale) : null, m > 0 ? formatUnit(m, "minute", locale) : null];
  return `~${parts.filter(Boolean).join(" ")}`;
}
