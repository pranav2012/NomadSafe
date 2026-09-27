/**
 * Parses a typed amount that may use "," or "." as the decimal mark. The last
 * separator is decimal when both appear or when it has one or two trailing
 * digits; a three-digit tail follows the locale's own decimal separator.
 */
export function parseAmountInput(value: string, decimalSeparator: string): number {
  const cleaned = value.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return Number.NaN;

  const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  if (lastSep < 0) return Number(cleaned);

  const whole = cleaned.slice(0, lastSep).replace(/[.,]/g, "");
  const fraction = cleaned.slice(lastSep + 1);
  const hasBoth = cleaned.includes(".") && cleaned.includes(",");
  const isDecimal = hasBoth || fraction.length !== 3 || cleaned[lastSep] === decimalSeparator;
  return Number(isDecimal ? `${whole || "0"}.${fraction}` : `${whole}${fraction}`);
}

/** The locale's decimal mark, e.g. "," for de-DE. */
export function localeDecimalSeparator(locale: string): string {
  try {
    return new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ".";
  } catch {
    return ".";
  }
}
