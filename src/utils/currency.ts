export const FALLBACK_CURRENCY = "USD";

export const CURRENCY_OPTIONS = [
  { code: "USD", name: "US Dollar" },
  { code: "INR", name: "Indian Rupee" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "AED", name: "UAE Dirham" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "CHF", name: "Swiss Franc" },
];

export function normalizeCurrencyCode(currency?: string | null) {
  const code = currency?.trim().toUpperCase();
  return code && /^[A-Z]{3}$/.test(code) ? code : FALLBACK_CURRENCY;
}

export function getEffectiveCurrency(currencyOverride: string | null, deviceCurrency?: string | null) {
  return currencyOverride ? normalizeCurrencyCode(currencyOverride) : normalizeCurrencyCode(deviceCurrency);
}


/** The picker's currency codes, with any of `extra` (e.g. the phone's currency) that aren't listed added first. */
export function currencyCodes(...extra: string[]): string[] {
  const listed = CURRENCY_OPTIONS.map((option) => option.code);
  return [...new Set([...extra.filter((code) => !listed.includes(code)), ...listed])];
}

/** Localized currency name ("Euro"), falling back to the English list, then the code. */
export function currencyDisplayName(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "currency" }).of(code);
    if (name && name !== code) return name;
  } catch {}
  return CURRENCY_OPTIONS.find((option) => option.code === code)?.name ?? code;
}
