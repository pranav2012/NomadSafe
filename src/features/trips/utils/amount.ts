export function sanitizeAmountInput(value: string) {
  return value.replace(/[^0-9.,]/g, "");
}

function localeDecimalSeparator(locale: string) {
  try {
    const part = new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((item) => item.type === "decimal");
    return part?.value === "," ? "," : ".";
  } catch {
    return ".";
  }
}

/** Parses "12,50", "1,250.75" or "1.250,75"; a lone separator + 3 digits is grouping unless it's the locale's decimal mark. */
export function parseAmount(value: string, locale: string): number {
  const cleaned = sanitizeAmountInput(value.trim());
  if (!cleaned) return Number.NaN;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const group = decimal === "," ? "." : ",";
    normalized = cleaned.split(group).join("").replace(decimal, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const parts = cleaned.split(separator);
    const looksGrouped =
      parts.length > 2 ||
      (parts[parts.length - 1].length === 3 && separator !== localeDecimalSeparator(locale));
    normalized = looksGrouped ? parts.join("") : `${parts[0]}.${parts.slice(1).join("")}`;
  } else {
    normalized = cleaned;
  }

  return Number(normalized);
}
