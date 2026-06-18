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

