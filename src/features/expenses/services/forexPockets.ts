import { showToast } from "@/atoms";
import { translate } from "@/localization/translate";
import { nextRecordId } from "@/utils/recordId";
import { track } from "@/modules/analytics";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { usePocketsStore } from "@/features/expenses/store/pocketsStore";
import { conversionResult, loadFee, pocketBalance, pocketRate, type ForexPocket, type PocketCloseKind, type PocketKind } from "@/features/expenses/utils/forex";

export interface LoadInput {
  groupId: string;
  kind: PocketKind;
  currency: string;
  homeCurrency: string;
  amount: number;
  paid: number;
  marketRate: number;
  date: string;
  logFee: boolean;
}

function addForexSpend(input: { groupId: string; merchant: string; amount: number; currency: string; category: "fees" | "other"; date: string }) {
  return useExpensesStore.getState().addExpense({ ...input, source: "forex", autoCategorized: false });
}

/** Adds bought or withdrawn forex to `pocketId`, or to a new pocket; the markup becomes a "Fees & forex" spend. */
export function loadForex(input: LoadInput, pocketId?: string): string {
  const { fee } = loadFee(input);
  const feeExpense =
    input.logFee && fee > 0
      ? addForexSpend({
          groupId: input.groupId,
          merchant: translate("forex.feeMerchant", { currency: input.currency }),
          amount: fee,
          currency: input.homeCurrency,
          category: "fees",
          date: input.date,
        })
      : null;
  const load = { date: input.date, amount: input.amount, paid: input.paid, marketRate: input.marketRate, feeExpenseId: feeExpense?.id };
  const store = usePocketsStore.getState();
  track("forex_loaded", { kind: input.kind, top_up: Boolean(pocketId), fee_logged: Boolean(feeExpense) });
  if (pocketId) {
    store.addLoad(pocketId, load);
    return pocketId;
  }
  return store.add({
    groupId: input.groupId,
    kind: input.kind,
    currency: input.currency,
    homeCurrency: input.homeCurrency,
    loads: [{ ...load, id: nextRecordId() }],
    spendIds: [],
  }).id;
}

/** Undoes a load: its fee spend goes, and a carried-over leftover returns to spare forex. */
export function removeLoad(pocket: ForexPocket, loadId: string) {
  const load = pocket.loads.find((entry) => entry.id === loadId);
  if (!load) return;
  if (load.feeExpenseId) useExpensesStore.getState().deleteExpense(load.feeExpenseId);
  const store = usePocketsStore.getState();
  if (load.carriedFrom) {
    const source = store.pockets.find((entry) => entry.id === load.carriedFrom);
    if (source?.closed) store.update(source.id, { closed: { ...source.closed, carriedTo: undefined } });
  }
  store.removeLoad(pocket.id, loadId);
}

/** Logs cash that went without a record, so the pocket matches what's in hand. */
export function logUntrackedCash(pocket: ForexPocket, gap: number) {
  if (!(gap > 0)) return;
  const expense = addForexSpend({
    groupId: pocket.groupId,
    merchant: translate(pocket.kind === "card" ? "forex.untrackedCard" : "forex.untrackedCash"),
    amount: gap,
    currency: pocket.currency,
    category: "other",
    date: new Date().toISOString(),
  });
  usePocketsStore.getState().setSpend(expense.id, pocket.id);
  track("forex_counted", { kind: pocket.kind, logged_gap: true });
}

export function removeUntracked(pocket: ForexPocket, expenseId: string) {
  useExpensesStore.getState().deleteExpense(expenseId);
  usePocketsStore.getState().setSpend(expenseId, null);
}

/**
 * Ends the pocket for this trip. Kept: the leftover waits as spare forex for the next trip. Converted: the
 * loss (or gain, negative) against the pocket rate is a spend. Written off: the leftover counts as spent.
 */
export function closePocket(pocket: ForexPocket, kind: PocketCloseKind, received = 0) {
  const { left, rate } = pocketBalance(pocket, useExpensesStore.getState().expenses);
  const leftover = Math.max(0, left);
  const date = new Date().toISOString();
  const store = usePocketsStore.getState();
  let expenseId: string | undefined;
  if (kind === "writtenOff" && leftover > 0) {
    expenseId = addForexSpend({
      groupId: pocket.groupId,
      merchant: translate("forex.leftoverMerchant", { currency: pocket.currency }),
      amount: leftover,
      currency: pocket.currency,
      category: "other",
      date,
    }).id;
    store.setSpend(expenseId, pocket.id);
  }
  if (kind === "converted") {
    const result = conversionResult({ leftover, rate, received, homeCurrency: pocket.homeCurrency });
    if (result !== 0) {
      expenseId = addForexSpend({
        groupId: pocket.groupId,
        merchant: translate(result > 0 ? "forex.lossMerchant" : "forex.gainMerchant", { currency: pocket.currency }),
        amount: result,
        currency: pocket.homeCurrency,
        category: "fees",
        date,
      }).id;
    }
  }
  usePocketsStore.getState().close(pocket.id, { kind, date, leftover, received: kind === "converted" ? received : undefined, expenseId });
  track("forex_closed", { kind, had_leftover: leftover > 0 });
}

/** Reopens a closed pocket, removing its leftover spend and taking back a carried-over leftover. */
export function reopenPocket(pocket: ForexPocket) {
  const closed = pocket.closed;
  if (!closed) return;
  const store = usePocketsStore.getState();
  if (closed.expenseId) {
    useExpensesStore.getState().deleteExpense(closed.expenseId);
    store.setSpend(closed.expenseId, null);
  }
  if (closed.carriedTo) {
    for (const target of store.pockets) {
      const carried = target.loads.find((load) => load.carriedFrom === pocket.id);
      if (carried) store.removeLoad(target.id, carried.id);
    }
  }
  usePocketsStore.getState().reopen(pocket.id);
}

/** Moves a kept leftover onto `tripId`, valued at the old pocket's rate (no new fee). */
export function carryToTrip(spare: ForexPocket, tripId: string) {
  if (!spare.closed || spare.closed.kind !== "kept") return;
  const store = usePocketsStore.getState();
  const rate = pocketRate(spare);
  const amount = spare.closed.leftover;
  const load = { date: new Date().toISOString(), amount, paid: amount * rate, marketRate: rate, carriedFrom: spare.id };
  const target = store.pockets.find((pocket) => pocket.groupId === tripId && !pocket.closed && pocket.currency === spare.currency && pocket.kind === spare.kind);
  if (target) store.addLoad(target.id, load);
  else store.add({ groupId: tripId, kind: spare.kind, currency: spare.currency, homeCurrency: spare.homeCurrency, loads: [{ ...load, id: nextRecordId() }], spendIds: [] });
  usePocketsStore.getState().update(spare.id, { closed: { ...spare.closed, carriedTo: tripId } });
  track("forex_carried", { kind: spare.kind });
}

/** Deletes the pocket and the spends it made (fees, untracked cash, leftover); spends paid from it stay as ordinary spends. */
export function deletePocket(pocket: ForexPocket) {
  if (pocket.closed) reopenPocket(pocket);
  const current = usePocketsStore.getState().pockets.find((entry) => entry.id === pocket.id) ?? pocket;
  for (const load of current.loads) removeLoad(current, load.id);
  const expenses = useExpensesStore.getState();
  const own = new Set(current.spendIds);
  expenses.removeExpenses(expenses.expenses.filter((expense) => own.has(expense.id) && expense.source === "forex").map((expense) => expense.id));
  usePocketsStore.getState().remove(pocket.id);
}

export function pocketOfExpense(pockets: readonly ForexPocket[], expenseId: string): ForexPocket | null {
  return pockets.find((pocket) => pocket.spendIds.includes(expenseId)) ?? null;
}

/** Hides a trip's "Got forex?" prompt, with Undo and a pointer to the Money ⋯ menu where it stays available. */
export function dismissForexPrompt(tripId: string) {
  usePocketsStore.getState().dismissPrompt(tripId);
  showToast(translate("forex.hiddenTitle"), translate("forex.hiddenBody"), {
    label: translate("forex.undo"),
    onPress: () => usePocketsStore.getState().restorePrompt(tripId),
  });
}

/** Which pocket made a "forex" spend (its fee, untracked cash, leftover or conversion result). */
export function pocketOfForexSpend(pockets: readonly ForexPocket[], expenseId: string): ForexPocket | null {
  return (
    pockets.find(
      (pocket) =>
        pocket.spendIds.includes(expenseId) || pocket.closed?.expenseId === expenseId || pocket.loads.some((load) => load.feeExpenseId === expenseId),
    ) ?? null
  );
}
