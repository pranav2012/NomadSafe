import { payersOf, roundMoney, SELF_ID, type ExpensePayer } from "./split";

export type PocketKind = "cash" | "card";

export interface PocketLoad {
  id: string;
  date: string;
  amount: number;
  paid: number;
  /** Home currency per foreign unit on the market that day. */
  marketRate: number;
  feeExpenseId?: string;
  carriedFrom?: string;
}

export type PocketCloseKind = "kept" | "converted" | "writtenOff";

export interface PocketClose {
  kind: PocketCloseKind;
  date: string;
  leftover: number;
  received?: number;
  expenseId?: string;
  carriedTo?: string;
}

/**
 * Forex cash or a forex card for one trip. Loading it is a transfer, never a spend: only the fee over
 * market and the spends paid from it count. Private to the owner (never shared with trip members).
 */
export interface ForexPocket {
  id: string;
  groupId: string;
  kind: PocketKind;
  currency: string;
  homeCurrency: string;
  loads: PocketLoad[];
  spendIds: string[];
  closed?: PocketClose;
  createdAt: string;
}

export interface PocketSpendLike {
  id: string;
  groupId: string | null;
  amount: number;
  currency: string;
  paidBy?: string;
  payers?: ExpensePayer[];
}

function paidByYou(expense: PocketSpendLike): number {
  return payersOf(expense).filter((payer) => payer.person === SELF_ID).reduce((sum, payer) => sum + payer.amount, 0);
}

export function loadedAmount(pocket: Pick<ForexPocket, "loads">): number {
  return pocket.loads.reduce((sum, load) => sum + load.amount, 0);
}

export function pocketRate(pocket: Pick<ForexPocket, "loads">): number {
  const amount = loadedAmount(pocket);
  if (amount <= 0) return 0;
  return pocket.loads.reduce((sum, load) => sum + load.amount * load.marketRate, 0) / amount;
}

/** Spends that still draw on the pocket: in its trip and currency (moved or re-priced ones drop out). */
export function pocketSpends<T extends PocketSpendLike>(pocket: ForexPocket, expenses: readonly T[]): T[] {
  const ids = new Set(pocket.spendIds);
  return expenses.filter((expense) => ids.has(expense.id) && expense.groupId === pocket.groupId && expense.currency === pocket.currency);
}

export interface PocketBalance {
  loaded: number;
  spent: number;
  left: number;
  rate: number;
  leftValue: number;
  spentValue: number;
}

export function pocketBalance(pocket: ForexPocket, expenses: readonly PocketSpendLike[]): PocketBalance {
  const loaded = roundMoney(loadedAmount(pocket), pocket.currency);
  const spent = roundMoney(
    pocketSpends(pocket, expenses).reduce((sum, expense) => sum + paidByYou(expense), 0),
    pocket.currency,
  );
  const handedOff = pocket.closed && pocket.closed.kind !== "writtenOff";
  const left = handedOff ? 0 : roundMoney(loaded - spent, pocket.currency);
  const rate = pocketRate(pocket);
  return {
    loaded,
    spent,
    left,
    rate,
    leftValue: roundMoney(left * rate, pocket.homeCurrency),
    spentValue: roundMoney(spent * rate, pocket.homeCurrency),
  };
}

export interface LoadFee {
  fee: number;
  pct: number;
  marketValue: number;
}

/** The markup on a forex purchase. Paying below market logs nothing (the spends then carry the saving). */
export function loadFee(input: { amount: number; paid: number; marketRate: number; homeCurrency: string }): LoadFee {
  const marketValue = roundMoney(input.amount * input.marketRate, input.homeCurrency);
  const over = roundMoney(input.paid - marketValue, input.homeCurrency);
  if (!(marketValue > 0) || !(over > 0)) return { fee: 0, pct: 0, marketValue };
  return { fee: over, pct: (over / marketValue) * 100, marketValue };
}

/** Converting the leftover back: positive is a loss (adds to the trip), negative a gain (lowers it). */
export function conversionResult(input: { leftover: number; rate: number; received: number; homeCurrency: string }): number {
  return roundMoney(input.leftover * input.rate - input.received, input.homeCurrency);
}

/**
 * Counting what's really in hand: a positive gap is cash spent but never logged. A negative gap means
 * more is in hand than expected (a card spend logged as cash, or a top-up never added); nothing is logged.
 */
export function countedGap(left: number, counted: number, currency: string): number {
  return roundMoney(left - counted, currency);
}

export function sparePockets(pockets: readonly ForexPocket[]): ForexPocket[] {
  return pockets
    .filter((pocket) => pocket.closed?.kind === "kept" && !pocket.closed.carriedTo && pocket.closed.leftover > 0)
    .sort((a, b) => (b.closed?.date ?? "").localeCompare(a.closed?.date ?? ""));
}

export interface PocketRateHint {
  currency: string;
  homeCurrency: string;
  rate: number;
}

/**
 * Rate per expense id for spends paid from a pocket, so they count at what the forex cost on the market
 * when it was loaded (the fee is already its own spend).
 */
export function pocketRateHints(pockets: readonly ForexPocket[]): Map<string, PocketRateHint> {
  const hints = new Map<string, PocketRateHint>();
  for (const pocket of pockets) {
    const rate = pocketRate(pocket);
    if (!(rate > 0)) continue;
    for (const id of pocket.spendIds) hints.set(id, { currency: pocket.currency, homeCurrency: pocket.homeCurrency, rate });
  }
  return hints;
}

export function hintedRate(hint: PocketRateHint | undefined, currency: string, target: string): number | undefined {
  if (!hint || hint.currency !== currency) return undefined;
  if (target === hint.homeCurrency) return hint.rate;
  return undefined;
}

export function payablePockets(pockets: readonly ForexPocket[], groupId: string | null, currency?: string): ForexPocket[] {
  return pockets
    .filter((pocket) => pocket.groupId === groupId && !pocket.closed && (currency === undefined || pocket.currency === currency))
    .sort((a, b) => (a.kind === b.kind ? a.createdAt.localeCompare(b.createdAt) : a.kind === "cash" ? -1 : 1));
}

/** Pocket that should be picked for a new spend in `currency`: the only open cash pocket in it, if there is one. */
export function defaultPocketFor(pockets: readonly ForexPocket[], groupId: string | null, currency: string): ForexPocket | null {
  const cash = payablePockets(pockets, groupId, currency).filter((pocket) => pocket.kind === "cash");
  return cash.length === 1 ? cash[0] : null;
}

const CASH_WORDS = /\b(cash|forex|in notes)\b|नकद|कैश|現金|げんきん|현금|efectivo|espèces|bargeld|contanti|dinheiro|نقد|நகத|ನಗದು|నగదు|പണമായി|现金/i;

/** Whether a spoken spend says it was paid in cash ("1,200 yen cash for ramen"). */
export function saysCash(transcript: string): boolean {
  return CASH_WORDS.test(transcript);
}
