import type { ExpenseCategory } from "@/features/expenses/constants/categories";

export type ImportSource = "splitwise" | "settleup";

export interface ImportRow {
  kind: "expense" | "payment" | "personal";
  date: string;
  description: string;
  category: ExpenseCategory | null;
  currency: string;
  amount: number;
  payers: { person: string; amount: number }[];
  shares: { person: string; amount: number }[];
  /** Splitwise doesn't say what each of several payers paid; their split among themselves is assumed equal. */
  estimated?: boolean;
  key: string;
}

export interface ParsedImport {
  source: ImportSource;
  people: string[];
  former: string[];
  rows: ImportRow[];
  totals: Record<string, Record<string, number>> | null;
}

/** Text of an exported file: UTF-16 (with BOM, as Settle Up writes) or UTF-8. */
export function decodeBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    const little = bytes[0] === 0xff;
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode(little ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  let out = "";
  for (let i = start; i < bytes.length; ) {
    const byte = bytes[i];
    let code: number;
    if (byte < 0x80) {
      code = byte;
      i += 1;
    } else if (byte >> 5 === 0x6) {
      code = ((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (byte >> 4 === 0xe) {
      code = ((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      code = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

/** RFC 4180 CSV (quoted commas, "" and line breaks); blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export function detectSource(header: string[]): ImportSource | null {
  const cells = header.map((cell) => cell.trim().toLowerCase());
  if (cells[0] === "date" && cells[1] === "description" && cells[3] === "cost" && cells[4] === "currency") return "splitwise";
  if (cells.includes("who paid") && cells.includes("for whom") && cells.includes("split amounts")) return "settleup";
  return null;
}

const SPLITWISE_CATEGORIES: Record<string, ExpenseCategory> = {
  "dining out": "food",
  groceries: "food",
  "food and drink - other": "food",
  liquor: "food",
  hotel: "stays",
  rent: "stays",
  "bus/train": "travel",
  taxi: "travel",
  car: "travel",
  "gas/fuel": "travel",
  parking: "travel",
  plane: "travel",
  bicycle: "travel",
  "transportation - other": "travel",
  clothing: "shopping",
  electronics: "shopping",
  gifts: "shopping",
  "household supplies": "shopping",
  furniture: "shopping",
};

const EMOJI_CATEGORIES: [RegExp, ExpenseCategory][] = [
  [/[🍔🍕🍜🍣🍺🍷☕🍽🥘🛒🍦🍰🥗]/u, "food"],
  [/[🏨🏠🛏⛺]/u, "stays"],
  [/[✈🚆🚌🚕🚗⛽🅿🚇🚢🚲🛵🚄]/u, "travel"],
  [/[🛍👕🎁📱💻]/u, "shopping"],
];

const round2 = (value: number) => Math.round(value * 100) / 100;
const num = (text: string) => {
  const value = Number(text.trim());
  return Number.isFinite(value) ? value : NaN;
};

/**
 * Splitwise's group export: one column per person holding their net for the row (positive lent,
 * negative owes). Shares are rebuilt from the nets; with several payers, what each paid isn't in the
 * file, so the payers' own shares are assumed equal (totals and balances stay exact).
 */
export function parseSplitwise(table: string[][]): ParsedImport {
  const header = table[0];
  const rawPeople = header.slice(5).map((cell) => cell.trim());
  const former = rawPeople.filter((name) => / \(removed\)$/.test(name)).map((name) => name.replace(/ \(removed\)$/, ""));
  const people = rawPeople.map((name) => name.replace(/ \(removed\)$/, ""));
  const rows: ImportRow[] = [];
  let totals: Record<string, Record<string, number>> | null = null;
  table.slice(1).forEach((cells, index) => {
    const description = (cells[1] ?? "").trim();
    const currency = (cells[4] ?? "").trim().toUpperCase();
    const nets = people.map((person, i) => ({ person, net: num(cells[5 + i] ?? "0") || 0 }));
    if (description.toLowerCase() === "total balance") {
      totals ??= {};
      for (const { person, net } of nets) (totals[person] ??= {})[currency] = net;
      return;
    }
    const cost = num(cells[3] ?? "");
    if (!Number.isFinite(cost) || !currency) return;
    const date = (cells[0] ?? "").trim().slice(0, 10);
    const category = (cells[2] ?? "").trim();
    const key = `splitwise:${index}:${date}:${description}:${cost}`;
    const positive = nets.filter((entry) => entry.net > 0.004);
    const negative = nets.filter((entry) => entry.net < -0.004);
    if (category.toLowerCase() === "payment") {
      if (positive.length === 0 || negative.length === 0) return;
      rows.push({
        kind: "payment",
        date,
        description,
        category: null,
        currency,
        amount: cost,
        payers: [{ person: positive[0].person, amount: cost }],
        shares: [{ person: negative[0].person, amount: cost }],
        key,
      });
      return;
    }
    const base = { date, description, category: SPLITWISE_CATEGORIES[category.toLowerCase()] ?? null, currency, amount: cost, key };
    if (positive.length === 0) {
      rows.push({ ...base, kind: "personal", payers: [], shares: [] });
      return;
    }
    const owed = negative.map((entry) => ({ person: entry.person, amount: round2(-entry.net) }));
    const payersShare = round2(cost - owed.reduce((sum, share) => sum + share.amount, 0));
    const each = round2(payersShare / positive.length);
    const payerShares = positive.map((entry, i) => ({ person: entry.person, amount: i === positive.length - 1 ? round2(payersShare - each * (positive.length - 1)) : each }));
    rows.push({
      ...base,
      kind: "expense",
      payers: payerShares.map((share, i) => ({ person: share.person, amount: round2(share.amount + positive[i].net) })),
      shares: [...payerShares, ...owed].filter((share) => share.amount > 0.004),
      estimated: positive.length > 1,
    });
  });
  return { source: "splitwise", people, former, rows, totals };
}

/** Settle Up's export: payers, people and split amounts are explicit (";"-separated lists). */
export function parseSettleUp(table: string[][]): ParsedImport {
  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const at = (name: string) => header.indexOf(name);
  const col = {
    payer: at("who paid"),
    amount: at("amount"),
    currency: at("currency"),
    whom: at("for whom"),
    split: at("split amounts"),
    purpose: at("purpose"),
    category: at("category"),
    date: at("date & time"),
    type: at("type"),
  };
  const list = (text: string | undefined) => (text ?? "").split(";").map((part) => part.trim()).filter(Boolean);
  const people = new Set<string>();
  const rows: ImportRow[] = [];
  table.slice(1).forEach((cells, index) => {
    const payerNames = list(cells[col.payer]);
    const paid = list(cells[col.amount]).map(num);
    const whom = list(cells[col.whom]);
    const split = list(cells[col.split]).map(num);
    const currency = (cells[col.currency] ?? "").trim().toUpperCase();
    if (payerNames.length === 0 || payerNames.length !== paid.length || paid.some((value) => !Number.isFinite(value)) || !currency) return;
    payerNames.forEach((name) => people.add(name));
    whom.forEach((name) => people.add(name));
    const amount = round2(paid.reduce((sum, value) => sum + value, 0));
    const date = (cells[col.date] ?? "").trim().slice(0, 10);
    const description = (cells[col.purpose] ?? "").trim();
    const key = `settleup:${index}:${date}:${description}:${amount}`;
    const payers = payerNames.map((person, i) => ({ person, amount: paid[i] }));
    if ((cells[col.type] ?? "").trim().toLowerCase() === "transfer") {
      if (whom.length === 0) return;
      rows.push({ kind: "payment", date, description, category: null, currency, amount, payers: [{ person: payerNames[0], amount }], shares: [{ person: whom[0], amount }], key });
      return;
    }
    const shares = whom.map((person, i) => ({ person, amount: Number.isFinite(split[i]) ? split[i] : 0 }));
    // Settle Up rounds each share; give the leftover cents to the largest share so they add up.
    const gap = round2(amount - shares.reduce((sum, share) => sum + share.amount, 0));
    if (shares.length > 0 && Math.abs(gap) > 0 && Math.abs(gap) < 0.05 * shares.length) {
      const largest = shares.reduce((best, share) => (share.amount > best.amount ? share : best), shares[0]);
      largest.amount = round2(largest.amount + gap);
    }
    const emoji = (cells[col.category] ?? "").trim();
    rows.push({
      kind: "expense",
      date,
      description,
      category: EMOJI_CATEGORIES.find(([pattern]) => pattern.test(emoji))?.[1] ?? null,
      currency,
      amount,
      payers,
      shares,
      key,
    });
  });
  return { source: "settleup", people: [...people], former: [], rows, totals: null };
}

export function parseImport(text: string): ParsedImport | null {
  const table = parseCsv(text);
  if (table.length < 2) return null;
  const source = detectSource(table[0]);
  if (source === "splitwise") return parseSplitwise(table);
  if (source === "settleup") return parseSettleUp(table);
  return null;
}

export function importBalances(rows: ImportRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const add = (person: string, currency: string, value: number) => {
    const byCurrency = (out[person] ??= {});
    byCurrency[currency] = round2((byCurrency[currency] ?? 0) + value);
  };
  for (const row of rows) {
    if (row.kind === "personal") continue;
    for (const payer of row.payers) add(payer.person, row.currency, payer.amount);
    for (const share of row.shares) add(share.person, row.currency, -share.amount);
  }
  return out;
}

/** True when the rebuilt balances match Splitwise's own Total balance row (within a cent per row of rounding). */
export function matchesTotals(rows: ImportRow[], totals: Record<string, Record<string, number>>): boolean {
  const ours = importBalances(rows);
  const tolerance = 0.02 + rows.length * 0.005;
  return Object.entries(totals).every(([person, byCurrency]) =>
    Object.entries(byCurrency).every(([currency, value]) => Math.abs((ours[person]?.[currency] ?? 0) - value) <= tolerance),
  );
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = [0, 1, 2, 3].map((offset) => BASE64.indexOf(clean[i + offset] ?? "A"));
    const value = (chunk[0] << 18) | (chunk[1] << 12) | (chunk[2] << 6) | chunk[3];
    if (byteIndex < bytes.length) bytes[byteIndex++] = (value >> 16) & 0xff;
    if (byteIndex < bytes.length && i + 2 < clean.length) bytes[byteIndex++] = (value >> 8) & 0xff;
    if (byteIndex < bytes.length && i + 3 < clean.length) bytes[byteIndex++] = value & 0xff;
  }
  return bytes.slice(0, byteIndex);
}
