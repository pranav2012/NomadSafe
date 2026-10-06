export interface ReceiptGuess {
  amount: number | null;
  merchant: string | null;
  /** YYYY-MM-DD when a date was found. */
  date: string | null;
  items: { name: string; amount: number }[];
}

const TOTAL_WORDS = /\b(grand\s*total|total\s*(amount|due|payable)?|amount\s*(due|payable)|net\s*payable|balance\s*due|to\s*pay|gesamt|summe|total\s*ttc|importe|totale)\b/i;
const SKIP_ITEM = /\b(date|time|invoice|bill\s*no|table|sub\s*total|subtotal|total|tax|vat|gst|cgst|sgst|igst|service|tip|change|cash|card|visa|mastercard|upi|paid|round|discount|balance|qty|amount)\b/i;
const AMOUNT = /(-?\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{1,2})|-?\d+(?:[.,]\d{1,2})?)\s*$/;

/** "1,234.50", "1.234,50" or "1234" as a number; null when it isn't one. */
export function parseAmount(text: string): number | null {
  const raw = text.replace(/[^\d.,-]/g, "");
  if (!raw || !/\d/.test(raw)) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  const decimalAt = Math.max(lastComma, lastDot);
  const decimals = decimalAt >= 0 ? raw.length - decimalAt - 1 : 0;
  let normalized: string;
  if (decimalAt >= 0 && decimals > 0 && decimals <= 2) {
    normalized = raw.slice(0, decimalAt).replace(/[.,]/g, "") + "." + raw.slice(decimalAt + 1);
  } else {
    normalized = raw.replace(/[.,]/g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function lineAmount(line: string): number | null {
  const match = line.match(AMOUNT);
  return match ? parseAmount(match[1]) : null;
}

function findDate(lines: string[]): string | null {
  for (const line of lines) {
    const iso = line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    const dmy = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
    if (dmy) {
      const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
      const first = Number(dmy[1]);
      const second = Number(dmy[2]);
      // Day first unless that can't be a month/day pair (most receipts outside the US are day first).
      const [day, month] = first > 12 || second <= 12 ? [first, second] : [second, first];
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

/**
 * A first guess from the text of a receipt: the total (a "total" line, else the largest amount), the
 * shop (the first line with letters and no amount), the date, and lines that look like items.
 */
export function guessReceipt(lines: string[]): ReceiptGuess {
  const clean = lines.map((line) => line.trim()).filter(Boolean);
  let amount: number | null = null;
  for (let index = clean.length - 1; index >= 0; index -= 1) {
    if (!TOTAL_WORDS.test(clean[index]) || /sub\s*total/i.test(clean[index])) continue;
    amount = lineAmount(clean[index]) ?? (index + 1 < clean.length ? lineAmount(clean[index + 1]) : null);
    if (amount !== null) break;
  }
  if (amount === null) {
    const all = clean.map(lineAmount).filter((value): value is number => value !== null && value > 0);
    amount = all.length ? Math.max(...all) : null;
  }
  const merchant = clean.slice(0, 6).find((line) => /\p{L}{3}/u.test(line) && lineAmount(line) === null && !/receipt|invoice|tax|bill|gst/i.test(line)) ?? null;
  const items = clean
    .filter((line) => !SKIP_ITEM.test(line) && !/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}:\d{2}/.test(line))
    .map((line) => {
      const value = lineAmount(line);
      const name = line.replace(AMOUNT, "").replace(/[\s:x*@-]+$/i, "").trim();
      return value !== null && value > 0 && /\p{L}{2}/u.test(name) ? { name, amount: value } : null;
    })
    .filter((item): item is { name: string; amount: number } => item !== null);
  return { amount, merchant, date: findDate(clean), items };
}

/**
 * Each person's weight for an itemised split: their part of every item they had (items shared
 * equally among the people on them) plus extras in proportion. Feed to `splitByUnits` with the
 * spend's total so the shares add up exactly.
 */
export function itemWeights(items: { amount: number; people: string[] }[], extras: number): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const item of items) {
    if (item.people.length === 0) continue;
    for (const person of item.people) weights[person] = (weights[person] ?? 0) + item.amount / item.people.length;
  }
  const itemsTotal = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (itemsTotal > 0 && extras > 0) {
    for (const person of Object.keys(weights)) weights[person] += (weights[person] / itemsTotal) * extras;
  }
  return weights;
}
