export type TransactionKind = "debit" | "credit";

export interface ParsedTransaction {
  amount: number;
  currency: string;
  merchant: string;
  kind: TransactionKind;
  occurredAt: string;
  raw: string;
}

const SYMBOL_TO_CODE: Record<string, string> = {
  "₹": "INR",
  rs: "INR",
  "rs.": "INR",
  inr: "INR",
  "$": "USD",
  usd: "USD",
  us$: "USD",
  "€": "EUR",
  eur: "EUR",
  "£": "GBP",
  gbp: "GBP",
  "¥": "JPY",
  jpy: "JPY",
  aed: "AED",
  dhs: "AED",
  sgd: "SGD",
  "s$": "SGD",
  aud: "AUD",
  cad: "CAD",
  chf: "CHF",
  thb: "THB",
  "฿": "THB",
  vnd: "VND",
  idr: "IDR",
  rp: "IDR",
};

const DEBIT_HINTS = [
  "debited",
  "debit",
  "spent",
  "paid",
  "payment of",
  "purchase",
  "withdrawn",
  "charged",
  "sent to",
  "txn of",
  "transaction of",
  "deducted",
];

const CREDIT_HINTS = [
  "credited",
  "credit",
  "received",
  "refund",
  "deposited",
  "cashback",
  "added to",
];

// Amount preceded by a currency token, e.g. "Rs.450.00", "INR 1,200", "$48.50", "₹ 350".
const AMOUNT_WITH_CURRENCY =
  /(₹|\$|€|£|¥|฿|rs\.?|inr|usd|us\$|eur|gbp|jpy|aed|dhs|sgd|s\$|aud|cad|chf|thb|vnd|idr|rp)\s?([\d,]+(?:\.\d{1,2})?)/i;

// Amount followed by a currency code, e.g. "1,200 INR", "48.50 USD".
const CURRENCY_AFTER_AMOUNT =
  /([\d,]+(?:\.\d{1,2})?)\s?(inr|usd|eur|gbp|jpy|aed|sgd|aud|cad|chf|thb|vnd|idr)\b/i;

function detectKind(text: string): TransactionKind | null {
  const lower = text.toLowerCase();
  const hasDebit = DEBIT_HINTS.some((hint) => lower.includes(hint));
  const hasCredit = CREDIT_HINTS.some((hint) => lower.includes(hint));
  if (isConfirmedBooking(text) && !/\b(?:cancelled|canceled|refunded)\b/i.test(text)) {
    return "debit";
  }
  if (hasDebit && !hasCredit) return "debit";
  if (hasCredit && !hasDebit) return "credit";
  // Ambiguous: prefer debit when an explicit debit verb appears, otherwise null.
  if (hasDebit) return "debit";
  return null;
}

export function isConfirmedBooking(text: string): boolean {
  return /\b(?:flight|hotel|stay|visa|booking|reservation)\b[\s\S]{0,60}\b(?:confirmed|confirmation|issued|successful)\b/i.test(
    text,
  );
}

export function isStayEmail(text: string): boolean {
  return /\b(?:hotel|hostel|resort|accommodation|property|stay|booking\.com|airbnb|agoda|oyo|guesthouse|lodge|inn)\b/i.test(
    text,
  );
}

export function isFlightEmail(text: string): boolean {
  return /\b(?:flight|airline|airport|boarding|e-ticket|pnr)\b/i.test(text);
}

function normalizeCurrency(token: string): string {
  const key = token.trim().toLowerCase();
  return SYMBOL_TO_CODE[key] ?? "USD";
}

// In a full email body there are often several amounts (subtotal, tax, total).
// Prefer one that directly follows a "total / amount paid / charged" cue.
const TOTAL_CUE =
  /\b(?:grand\s+total|total\s+amount|amount\s+paid|you\s+paid|total\s+paid|order\s+total|amount\s+charged|total|paid|charged|debited)\b\D{0,15}?(₹|\$|€|£|¥|฿|rs\.?|inr|usd|us\$|eur|gbp|jpy|aed|dhs|sgd|s\$|aud|cad|chf|thb|vnd|idr|rp)\s?([\d,]+(?:\.\d{1,2})?)/i;

const BOOKING_TOTAL_CUE =
  /\b(?:total\s+(?:price|cost|upcoming\s+payments)|amount\s+due)\b\D{0,20}?(₹|\$|€|£|¥|฿|rs\.?|inr|usd|us\$|eur|gbp|jpy|aed|dhs|sgd|s\$|aud|cad|chf|thb|vnd|idr|rp)\s?([\d,]+(?:\.\d{1,2})?)/gi;

const BOOKING_FINAL_TOTAL_CUE =
  /\btotal\b(?!\s+(?:tax|paid|upcoming|price|cost))\D{0,20}?(₹|\$|€|£|¥|฿|rs\.?|inr|usd|us\$|eur|gbp|jpy|aed|dhs|sgd|s\$|aud|cad|chf|thb|vnd|idr|rp)\s?([\d,]+(?:\.\d{1,2})?)/gi;

const OUT_OF_POCKET_CUE =
  /\b(?:paid\s+by\s+cash|cash\s+paid|amount\s+paid|amount\s+charged|you\s+paid|charged)\b\D{0,20}?(₹|\$|€|£|¥|฿|rs\.?|inr|usd|us\$|eur|gbp|jpy|aed|dhs|sgd|s\$|aud|cad|chf|thb|vnd|idr|rp)\s?([\d,]+(?:\.\d{1,2})?)/gi;

function parseAmount(text: string): { amount: number; currency: string } | null {
  for (const match of text.matchAll(OUT_OF_POCKET_CUE)) {
    const amount = Number(match[2].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) {
      return { amount, currency: normalizeCurrency(match[1]) };
    }
  }

  for (const match of text.matchAll(BOOKING_TOTAL_CUE)) {
    const amount = Number(match[2].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) {
      return { amount, currency: normalizeCurrency(match[1]) };
    }
  }

  if (isConfirmedBooking(text)) {
    for (const match of text.matchAll(BOOKING_FINAL_TOTAL_CUE)) {
      const amount = Number(match[2].replace(/,/g, ""));
      if (Number.isFinite(amount) && amount > 0) {
        return { amount, currency: normalizeCurrency(match[1]) };
      }
    }
  }

  const cued = text.match(TOTAL_CUE);
  if (cued) {
    const amount = Number(cued[2].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) {
      return { amount, currency: normalizeCurrency(cued[1]) };
    }
  }

  const withCurrency = text.match(AMOUNT_WITH_CURRENCY);
  if (withCurrency) {
    const amount = Number(withCurrency[2].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) {
      return { amount, currency: normalizeCurrency(withCurrency[1]) };
    }
  }

  const afterAmount = text.match(CURRENCY_AFTER_AMOUNT);
  if (afterAmount) {
    const amount = Number(afterAmount[1].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) {
      return { amount, currency: normalizeCurrency(afterAmount[2]) };
    }
  }

  return null;
}

/**
 * Derives a merchant name from an email's sender (e.g. "Amazon.in <auto@amazon.in>"
 * → "Amazon", "noreply@uber.com" → "Uber"). Used as a fallback when the body has
 * no clear "at <merchant>" phrase.
 */
export function merchantFromSender(sender?: string): string {
  if (!sender) return "";
  const trimmed = sender.trim();

  const nameMatch = trimmed.match(/^"?([^"<]+?)"?\s*</);
  const displayName = nameMatch?.[1]?.trim();
  if (displayName && !/^(no[\s-]?reply|do[\s-]?not[\s-]?reply|alerts?|notifications?)$/i.test(displayName)) {
    return cleanMerchant(displayName);
  }

  const emailMatch = trimmed.match(/[\w.+-]+@([\w.-]+)/);
  const domain = emailMatch?.[1];
  if (domain) {
    const core = domain
      .replace(/\.(com|net|org|co|io|in|us|uk|app|email|mail)(\.[a-z]{2})?$/i, "")
      .split(".")
      .pop();
    if (core && core.length >= 2) {
      return core.charAt(0).toUpperCase() + core.slice(1);
    }
  }

  return "";
}

// Pull a likely merchant name following common connectors in bank/UPI/card alerts.
function parseMerchant(text: string): string {
  const patterns = [
    /\bat\s+([A-Za-z0-9&.'\- ]{2,40})/i,
    /\bto\s+([A-Za-z0-9&.'\- ]{2,40})/i,
    /\btowards\s+([A-Za-z0-9&.'\- ]{2,40})/i,
    /\bvpa\s+([A-Za-z0-9@.\-_]{2,40})/i,
    /\bfor\s+([A-Za-z0-9&.'\- ]{2,40})/i,
    /\bin favou?r of\s+([A-Za-z0-9&.'\- ]{2,40})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = cleanMerchant(match[1]);
    if (candidate) return candidate;
  }

  return "";
}

const MERCHANT_STOP_WORDS = [
  "your",
  "a/c",
  "ac",
  "account",
  "card",
  "available",
  "avbl",
  "bal",
  "balance",
  "on",
  "ref",
  "info",
  "upi",
  "via",
  "is",
  "was",
  "no",
];

function cleanMerchant(raw: string): string {
  // Stop at sentence/clause boundaries that commonly follow the merchant.
  let value = raw.split(/\b(?:on|ref|info|avbl|bal|balance|upi ref|dated)\b/i)[0];
  value = value.replace(/[.;,*#].*$/, "");
  value = value.replace(/\s+/g, " ").trim();

  const words = value
    .split(" ")
    .filter((word) => word && !MERCHANT_STOP_WORDS.includes(word.toLowerCase()));
  value = words.join(" ").trim();

  // Title-case ALL-CAPS merchant strings for readability; keep mixed case as-is.
  if (value && value === value.toUpperCase()) {
    value = value
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return value.length >= 2 ? value.slice(0, 40) : "";
}

/** Extracts the booked property when a stay confirmation identifies one. */
export function hotelNameFromEmail(text: string): string {
  const patterns = [
    /\b(?:confirmed|confirmation)\s+at\s+([A-Za-z0-9&.'’()\- ]{2,80})/i,
    /\b(?:booking|reservation|stay)\s+(?:at|for)\s+([A-Za-z0-9&.'’()\- ]{2,80})/i,
    /\b(?:hotel|property|accommodation)\s*[:\-]\s*([A-Za-z0-9&.'’()\- ]{2,80})/i,
    /\b(?:hotel|resort|hostel|lodge|inn)\s+([A-Za-z0-9&.'’()\- ]{2,70})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const name = cleanMerchant(
      match[1]
        .replace(/\b(?:is|was|has been)?\s*confirmed\b.*$/i, "")
        .replace(/\b(?:check[- ]?in|check[- ]?out|on)\b.*$/i, ""),
    );
    if (name) return name;
  }

  return "";
}

/**
 * Parses a single bank/UPI/card alert (SMS body or email snippet) into a
 * transaction. Returns null when no monetary debit/credit can be confidently
 * extracted, so non-transactional messages are ignored by the importer.
 */
export function parseTransaction(
  text: string,
  occurredAt: string = new Date().toISOString(),
): ParsedTransaction | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const money = parseAmount(trimmed);
  if (!money) return null;

  const kind = detectKind(trimmed);
  if (!kind) return null;

  return {
    amount: money.amount,
    currency: money.currency,
    merchant: parseMerchant(trimmed),
    kind,
    occurredAt,
    raw: trimmed,
  };
}

export interface RawMessage {
  body: string;
  date?: string;
  /** Stable source id (e.g. Gmail message id) for reliable dedupe. */
  externalId?: string;
  /** Email "From" value, used to derive a merchant when the body is unclear. */
  sender?: string;
  /** Full email context retained as the imported expense note. */
  note?: string;
}

/** Parses many messages, keeping only debit transactions (actual spends). */
export function parseDebits(messages: RawMessage[]): ParsedTransaction[] {
  const results: ParsedTransaction[] = [];
  for (const message of messages) {
    const parsed = parseTransaction(message.body, message.date);
    if (parsed && parsed.kind === "debit") {
      results.push(parsed);
    }
  }
  return results;
}
