export type TransactionKind = "debit" | "credit";

export interface ParsedTransaction {
  amount: number;
  currency: string;
  merchant: string;
  kind: TransactionKind;
  occurredAt: string;
  raw: string;
}

export interface ParseOptions {
  /** Trip currency, used to resolve ambiguous symbols such as bare "$" or "¥". */
  currencyHint?: string;
  /** "Now" for resolving year-less body dates; defaults to the current time. */
  referenceDate?: Date;
}

const CODE_TOKENS: Record<string, string> = {
  rs: "INR",
  inr: "INR",
  usd: "USD",
  eur: "EUR",
  gbp: "GBP",
  jpy: "JPY",
  cny: "CNY",
  rmb: "CNY",
  aed: "AED",
  dhs: "AED",
  sgd: "SGD",
  aud: "AUD",
  cad: "CAD",
  nzd: "NZD",
  hkd: "HKD",
  chf: "CHF",
  thb: "THB",
  vnd: "VND",
  idr: "IDR",
  rp: "IDR",
  myr: "MYR",
};

const SYMBOL_TOKENS: Record<string, string> = {
  "₹": "INR",
  "€": "EUR",
  "£": "GBP",
  "฿": "THB",
  us$: "USD",
  a$: "AUD",
  au$: "AUD",
  c$: "CAD",
  ca$: "CAD",
  hk$: "HKD",
  nz$: "NZD",
  s$: "SGD",
};

const DOLLAR_CURRENCIES = new Set(["USD", "AUD", "CAD", "NZD", "HKD", "SGD"]);

// Letter-bounded so words like "hours", "corp" or "arcade" never read as rs / rp / cad.
const CURRENCY =
  String.raw`(₹|€|£|¥|฿|(?<![a-z])(?:us|au|a|ca|c|hk|nz|s)\$|\$|(?<![a-z])(?:rs\.?|inr|usd|eur|gbp|jpy|cny|rmb|aed|dhs|sgd|aud|cad|nzd|hkd|chf|thb|vnd|idr|rp|myr)(?![a-z]))`;
const AMOUNT = String.raw`(\d[\d.,]*\d|\d)`;

// Amount preceded by a currency token, e.g. "Rs.450.00", "INR 1,200", "$48.50", "₹ 350".
const AMOUNT_WITH_CURRENCY = new RegExp(`${CURRENCY}\\s?${AMOUNT}`, "i");

// Amount followed by a currency code, e.g. "1,200 INR", "48.50 USD".
const CURRENCY_AFTER_AMOUNT = new RegExp(
  String.raw`${AMOUNT}\s?(inr|usd|eur|gbp|jpy|cny|aed|sgd|aud|cad|nzd|hkd|chf|thb|vnd|idr|myr)(?![a-z])`,
  "i",
);

const OTP = /\b(?:otp|one[- ]time password|verification code)\b/i;
const DEBIT_STRONG = /\b(?:debited|deducted|withdrawn|spent|charged)\b/i;
const DEBIT_WEAK = /\b(?:debit(?!\s*card)|paid|payment\s+of|purchased?|sent\s+to|txn\s+of|transaction\s+of)\b/i;
const CREDIT_STRONG = /\b(?:credited|refund(?:ed)?|reversed|reversal|cashback)\b/i;
const CREDIT_WEAK = /\b(?:credit(?!\s*card)|received|deposited|added\s+to)\b/i;
const REFUND_LIKE = /\b(?:refund(?:ed)?|reversed|reversal|cashback)\b/i;
// UPI alerts often read "debited from A/c X and credited to <payee>".
const CREDITED_TO_PAYEE = /\bcredited\s+to\b(?!\s+(?:your|ur)\b)/i;
const STATEMENT_NOTICE =
  /\b(?:min(?:imum)?\.?\s+(?:amount|amt)\s+due|total\s+(?:amount\s+|amt\s+)?due|payment\s+due|amount\s+due|due\s+date|outstanding|statement\s+(?:is\s+)?(?:generated|ready))\b/i;
const BALANCE_NOTICE =
  /\b(?:(?:available|avl|avbl|current|closing|a\/c|account)\.?\s+bal(?:ance)?|balance\s+(?:is|of|in))\b/i;

function detectKind(text: string): TransactionKind | null {
  if (isConfirmedBooking(text) && !/\b(?:cancelled|canceled|refunded)\b/i.test(text)) {
    return "debit";
  }

  const debitStrong = DEBIT_STRONG.test(text);
  const creditStrong = CREDIT_STRONG.test(text);

  if (debitStrong && creditStrong) {
    if (REFUND_LIKE.test(text)) return "credit";
    if (CREDITED_TO_PAYEE.test(text)) return "debit";
    return null;
  }
  if (creditStrong) return "credit";
  if (debitStrong) return "debit";

  const debitWeak = DEBIT_WEAK.test(text);
  const creditWeak = CREDIT_WEAK.test(text);
  if (debitWeak && !creditWeak) return "debit";
  if (creditWeak && !debitWeak) return "credit";
  return null;
}

// Balance enquiries and card statements quote amounts but aren't spends.
function isNonTransactionalNotice(text: string): boolean {
  if (isConfirmedBooking(text)) return false;
  if (DEBIT_STRONG.test(text)) return false;
  return STATEMENT_NOTICE.test(text) || BALANCE_NOTICE.test(text);
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

function normalizeCurrency(token: string, hint?: string): string {
  const key = token.trim().toLowerCase().replace(/\.$/, "");
  const upperHint = hint?.toUpperCase();
  if (key === "$") return upperHint && DOLLAR_CURRENCIES.has(upperHint) ? upperHint : "USD";
  if (key === "¥") return upperHint === "CNY" ? "CNY" : "JPY";
  return SYMBOL_TOKENS[key] ?? CODE_TOKENS[key] ?? "USD";
}

/**
 * Converts a raw amount string to a number, detecting the separator style:
 * a final separator followed by exactly three digits is a thousands group
 * ("Rp 150.000", "1,23,456"); one or two digits make it the decimal mark
 * ("EUR 1.234,56", "1,23,456.50").
 */
export function normalizeAmount(raw: string): number {
  const lastSep = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  if (lastSep < 0) return Number(raw);
  const fraction = raw.slice(lastSep + 1);
  const whole = raw.slice(0, lastSep).replace(/[.,]/g, "");
  if (fraction.length === 3) return Number(`${whole}${fraction}`);
  return Number(`${whole}.${fraction}`);
}

// In a full email body there are often several amounts (subtotal, tax, total).
// Prefer one that directly follows a "total / amount paid / charged" cue.
const TOTAL_CUE = new RegExp(
  String.raw`\b(?:grand\s+total|total\s+amount|amount\s+paid|you\s+paid|total\s+paid|order\s+total|amount\s+charged|total|paid|charged|debited)\b\D{0,15}?${CURRENCY}\s?${AMOUNT}`,
  "i",
);

const BOOKING_TOTAL_CUE = new RegExp(
  String.raw`\b(?:total\s+(?:price|cost|upcoming\s+payments)|amount\s+due)\b\D{0,20}?${CURRENCY}\s?${AMOUNT}`,
  "gi",
);

const BOOKING_FINAL_TOTAL_CUE = new RegExp(
  String.raw`\btotal\b(?!\s+(?:tax|paid|upcoming|price|cost))\D{0,20}?${CURRENCY}\s?${AMOUNT}`,
  "gi",
);

const OUT_OF_POCKET_CUE = new RegExp(
  String.raw`\b(?:paid\s+by\s+cash|cash\s+paid|amount\s+paid|amount\s+charged|you\s+paid|charged)\b\D{0,20}?${CURRENCY}\s?${AMOUNT}`,
  "gi",
);

function toMoney(
  currencyToken: string,
  rawAmount: string,
  hint?: string,
): { amount: number; currency: string } | null {
  const amount = normalizeAmount(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: normalizeCurrency(currencyToken, hint) };
}

function parseAmount(text: string, hint?: string): { amount: number; currency: string } | null {
  for (const match of text.matchAll(OUT_OF_POCKET_CUE)) {
    const money = toMoney(match[1], match[2], hint);
    if (money) return money;
  }

  for (const match of text.matchAll(BOOKING_TOTAL_CUE)) {
    const money = toMoney(match[1], match[2], hint);
    if (money) return money;
  }

  if (isConfirmedBooking(text)) {
    for (const match of text.matchAll(BOOKING_FINAL_TOTAL_CUE)) {
      const money = toMoney(match[1], match[2], hint);
      if (money) return money;
    }
  }

  const cued = text.match(TOTAL_CUE);
  const cuedMoney = cued ? toMoney(cued[1], cued[2], hint) : null;
  if (cuedMoney) return cuedMoney;

  const withCurrency = text.match(AMOUNT_WITH_CURRENCY);
  const withCurrencyMoney = withCurrency ? toMoney(withCurrency[1], withCurrency[2], hint) : null;
  if (withCurrencyMoney) return withCurrencyMoney;

  const afterAmount = text.match(CURRENCY_AFTER_AMOUNT);
  return afterAmount ? toMoney(afterAmount[2], afterAmount[1], hint) : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const NUMERIC_DATE = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const NAMED_DATE =
  /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\.?(?:[\s,-]*(\d{4}|\d{2})(?![\d:]))?/gi;

// Local noon for a valid calendar date, rejecting rollovers like 31/02.
function buildLocalDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function expandYear(raw: string): number {
  const year = Number(raw);
  return raw.length === 2 ? 2000 + year : year;
}

/**
 * Finds the transaction date in an alert body ("12-05-26", "12/05/2026",
 * "12 May"), as local noon ISO. Year-less dates resolve to the most recent
 * occurrence; dates more than a day ahead of `reference` are ignored.
 */
export function parseBodyDate(text: string, reference: Date = new Date()): string | null {
  const latest = reference.getTime() + 24 * 60 * 60 * 1000;
  const candidates: { index: number; date: Date }[] = [];

  for (const match of text.matchAll(ISO_DATE)) {
    const date = buildLocalDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) candidates.push({ index: match.index ?? 0, date });
  }
  for (const match of text.matchAll(NUMERIC_DATE)) {
    const date = buildLocalDate(expandYear(match[3]), Number(match[2]), Number(match[1]));
    if (date) candidates.push({ index: match.index ?? 0, date });
  }
  for (const match of text.matchAll(NAMED_DATE)) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (match[3]) {
      const date = buildLocalDate(expandYear(match[3]), month, day);
      if (date) candidates.push({ index: match.index ?? 0, date });
      continue;
    }
    const thisYear = buildLocalDate(reference.getFullYear(), month, day);
    const date =
      thisYear && thisYear.getTime() <= latest
        ? thisYear
        : buildLocalDate(reference.getFullYear() - 1, month, day);
    if (date) candidates.push({ index: match.index ?? 0, date });
  }

  const first = candidates
    .filter((candidate) => candidate.date.getTime() <= latest)
    .sort((a, b) => a.index - b.index)[0];
  return first ? first.date.toISOString() : null;
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
 * Parses a single bank/UPI/card alert (pasted text or email body) into a
 * transaction. Returns null when no monetary debit/credit can be confidently
 * extracted, so non-transactional messages are ignored by the importer. When
 * `occurredAt` is omitted the date is read from the body, else "now".
 */
export function parseTransaction(
  text: string,
  occurredAt?: string,
  options: ParseOptions = {},
): ParsedTransaction | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (OTP.test(trimmed)) return null;
  if (isNonTransactionalNotice(trimmed)) return null;

  const money = parseAmount(trimmed, options.currencyHint);
  if (!money) return null;

  const kind = detectKind(trimmed);
  if (!kind) return null;

  const reference = options.referenceDate ?? new Date();
  return {
    amount: money.amount,
    currency: money.currency,
    merchant: parseMerchant(trimmed),
    kind,
    occurredAt: occurredAt ?? parseBodyDate(trimmed, reference) ?? reference.toISOString(),
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
