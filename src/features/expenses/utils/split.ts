/** Person id for the device owner in splits; companions are identified by their trip name. */
export const SELF_ID = "__self__";

export interface ExpenseShare {
  person: string;
  amount: number;
}

/** Someone who paid part of an expense paid by several people. */
export interface ExpensePayer {
  person: string;
  amount: number;
}

/** How the split was entered, so editing reopens it the same way; balances only use `shares`. */
export type SplitMode = "equal" | "percent" | "custom";

export interface ExpenseSplit {
  mode: SplitMode;
  /** Percent per person for `percent` splits; adds up to 100. */
  percents?: Record<string, number>;
}

export interface SplitExpenseLike {
  amount: number;
  currency: string;
  date: string;
  paidBy?: string;
  /** Set when several people paid; amounts add up to `amount`. Otherwise `paidBy` (or you) paid it all. */
  payers?: ExpensePayer[];
  shares?: ExpenseShare[];
}

export interface SettlementLike {
  from: string;
  to: string;
  amount: number;
  currency: string;
  date: string;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

const fractionDigitsCache = new Map<string, number>();

export function currencyFractionDigits(currency: string): number {
  const cached = fractionDigitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  fractionDigitsCache.set(currency, digits);
  return digits;
}

function toMinor(amount: number, digits: number): number {
  return Math.round(amount * 10 ** digits);
}

function fromMinor(minor: number, digits: number): number {
  return minor / 10 ** digits;
}

export function roundMoney(amount: number, currency: string): number {
  const digits = currencyFractionDigits(currency);
  return fromMinor(toMinor(amount, digits), digits);
}

/** Splits `amount` equally in minor units; leftover units go to the first people in order. */
export function splitEqually(amount: number, currency: string, people: string[]): ExpenseShare[] {
  const unique = [...new Set(people)];
  if (unique.length === 0) return [];
  const digits = currencyFractionDigits(currency);
  const total = toMinor(amount, digits);
  const base = Math.floor(total / unique.length);
  const remainder = total - base * unique.length;
  return unique.map((person, index) => ({
    person,
    amount: fromMinor(base + (index < remainder ? 1 : 0), digits),
  }));
}

export type ShareResolution =
  | { ok: true; shares: ExpenseShare[] }
  | { ok: false; reason: "no-people" | "over-total" | "under-total" };

/** Explicit amounts for some people; the rest of the total is split equally among the others. */
export function resolveShares(
  amount: number,
  currency: string,
  people: string[],
  explicit: ExpenseShare[] = [],
): ShareResolution {
  const digits = currencyFractionDigits(currency);
  const total = toMinor(amount, digits);
  const explicitByPerson = new Map<string, number>();
  for (const share of explicit) {
    explicitByPerson.set(share.person, (explicitByPerson.get(share.person) ?? 0) + toMinor(share.amount, digits));
  }
  const everyone = [...new Set([...people, ...explicitByPerson.keys()])];
  if (everyone.length === 0) return { ok: false, reason: "no-people" };

  const assigned = [...explicitByPerson.values()].reduce((sum, value) => sum + value, 0);
  const left = total - assigned;
  if (left < 0) return { ok: false, reason: "over-total" };

  const rest = everyone.filter((person) => !explicitByPerson.has(person));
  if (rest.length === 0 && left !== 0) return { ok: false, reason: "under-total" };

  const restShares = splitEqually(fromMinor(left, digits), currency, rest);
  const shares = everyone.map((person) => {
    const fixed = explicitByPerson.get(person);
    if (fixed !== undefined) return { person, amount: fromMinor(fixed, digits) };
    return restShares.find((share) => share.person === person) ?? { person, amount: 0 };
  });
  return { ok: true, shares };
}

export function isSplitExpense(expense: SplitExpenseLike): boolean {
  return Array.isArray(expense.shares) && expense.shares.length > 0;
}

/** Who paid how much: the several payers, else the single payer (unset means you) for the full amount. */
export function payersOf(expense: Pick<SplitExpenseLike, "amount" | "paidBy" | "payers">): ExpensePayer[] {
  if (expense.payers && expense.payers.length > 0) return expense.payers;
  return [{ person: expense.paidBy ?? SELF_ID, amount: expense.amount }];
}

/** True when the payers' amounts add up to the total (in minor units). */
export function payersMatchTotal(amount: number, currency: string, payers: ExpensePayer[]): boolean {
  const digits = currencyFractionDigits(currency);
  const paid = payers.reduce((sum, payer) => sum + toMinor(payer.amount, digits), 0);
  return payers.length > 0 && paid === toMinor(amount, digits);
}

export type PercentResolution =
  | { ok: true; shares: ExpenseShare[] }
  | { ok: false; reason: "no-people" | "not-100" };

/**
 * Splits `amount` by percent in minor units. Rounding leftovers go to the largest remainders, so the
 * shares always add up to the total. Percents must add up to 100.
 */
export function splitByPercent(amount: number, currency: string, percents: Record<string, number>): PercentResolution {
  const entries = Object.entries(percents).filter(([, percent]) => Number.isFinite(percent) && percent > 0);
  if (entries.length === 0) return { ok: false, reason: "no-people" };
  const totalPercent = entries.reduce((sum, [, percent]) => sum + percent, 0);
  if (Math.abs(totalPercent - 100) > 0.001) return { ok: false, reason: "not-100" };
  const digits = currencyFractionDigits(currency);
  const total = toMinor(amount, digits);
  const raw = entries.map(([person, percent]) => ({ person, exact: (total * percent) / 100 }));
  const floors = raw.map((entry) => ({ ...entry, minor: Math.floor(entry.exact) }));
  let left = total - floors.reduce((sum, entry) => sum + entry.minor, 0);
  const byRemainder = [...floors].sort((a, b) => b.exact - b.minor - (a.exact - a.minor));
  for (const entry of byRemainder) {
    if (left <= 0) break;
    entry.minor += 1;
    left -= 1;
  }
  return { ok: true, shares: floors.map((entry) => ({ person: entry.person, amount: fromMinor(entry.minor, digits) })) };
}

/** The split mode to show: the stored one, else equal when shares are equal, else custom. */
export function splitModeOf(expense: { split?: ExpenseSplit; shares?: ExpenseShare[]; currency: string }): SplitMode | null {
  if (!expense.shares || expense.shares.length === 0) return null;
  if (expense.split) return expense.split.mode;
  return isEqualSplit(expense.shares, expense.currency) ? "equal" : "custom";
}

/** What each person is owed (positive) or owes (negative), in the target currency. */
export function computeNetBalances(
  expenses: SplitExpenseLike[],
  settlements: SettlementLike[],
  convert: (amount: number, currency: string, date: string) => number | null,
): { net: Map<string, number>; unconverted: number } {
  const net = new Map<string, number>();
  let unconverted = 0;
  const add = (person: string, value: number) => net.set(person, (net.get(person) ?? 0) + value);

  for (const expense of expenses) {
    if (!isSplitExpense(expense)) continue;
    const rate = convert(1, expense.currency, expense.date);
    if (rate === null) {
      unconverted += 1;
      continue;
    }
    for (const payer of payersOf(expense)) add(payer.person, payer.amount * rate);
    for (const share of expense.shares ?? []) add(share.person, -share.amount * rate);
  }
  for (const settlement of settlements) {
    const rate = convert(1, settlement.currency, settlement.date);
    if (rate === null) {
      unconverted += 1;
      continue;
    }
    add(settlement.from, settlement.amount * rate);
    add(settlement.to, -settlement.amount * rate);
  }
  return { net, unconverted };
}

/** Greedy largest-debtor → largest-creditor matching; at most n-1 transfers. */
export function simplifyDebts(net: Map<string, number>, currency: string): Transfer[] {
  const digits = currencyFractionDigits(currency);
  const debtors: { person: string; minor: number }[] = [];
  const creditors: { person: string; minor: number }[] = [];
  for (const [person, value] of net) {
    const minor = toMinor(value, digits);
    if (minor < 0) debtors.push({ person, minor: -minor });
    else if (minor > 0) creditors.push({ person, minor });
  }

  const transfers: Transfer[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort((a, b) => b.minor - a.minor);
    creditors.sort((a, b) => b.minor - a.minor);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const minor = Math.min(debtor.minor, creditor.minor);
    transfers.push({ from: debtor.person, to: creditor.person, amount: fromMinor(minor, digits) });
    debtor.minor -= minor;
    creditor.minor -= minor;
    if (debtor.minor === 0) debtors.shift();
    if (creditor.minor === 0) creditors.shift();
  }
  return transfers;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

const SELF_WORDS = new Set(["me", "myself", "i", "self", "you", "mine", "my self"]);

export function isSelfWord(value: string): boolean {
  return value === SELF_ID || SELF_WORDS.has(normalizeName(value));
}

/** Exact, then first-name, then small edit-distance match (speech misspells names); null if ambiguous. */
export function matchCompanion(spoken: string, companions: string[]): string | null {
  const target = normalizeName(spoken);
  if (!target) return null;
  const normalized = companions.map((name) => ({ name, key: normalizeName(name) }));

  const exact = normalized.find((entry) => entry.key === target);
  if (exact) return exact.name;

  const byFirstName = normalized.filter((entry) => entry.key.split(" ")[0] === target.split(" ")[0]);
  if (byFirstName.length === 1) return byFirstName[0].name;

  const maxDistance = target.length <= 4 ? 1 : 2;
  const close = normalized
    .map((entry) => ({ ...entry, distance: editDistance(target, entry.key.split(" ")[0]) }))
    .filter((entry) => entry.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
  if (close.length === 0) return null;
  if (close.length > 1 && close[0].distance === close[1].distance) return null;
  return close[0].name;
}

/** True when shares differ by at most one minor unit, i.e. an equal split. */
export function isEqualSplit(shares: ExpenseShare[], currency: string): boolean {
  if (shares.length === 0) return false;
  const digits = currencyFractionDigits(currency);
  const minors = shares.map((share) => toMinor(share.amount, digits));
  return Math.max(...minors) - Math.min(...minors) <= 1;
}
