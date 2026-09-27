type FormatCurrency = (amount: number, currency?: string, options?: Intl.NumberFormatOptions) => string;

const COMPACT_FROM = 100_000;

/** Shows cents only when the amount has them ("$1,500" vs "$1,500.50"); large values stay compact. */
export function formatMoney(formatCurrency: FormatCurrency, amount: number, currency?: string): string {
  const hasCents = Math.round(Math.abs(amount) * 100) % 100 !== 0;
  if (hasCents || Math.abs(amount) >= COMPACT_FROM) return formatCurrency(amount, currency);
  return formatCurrency(amount, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
