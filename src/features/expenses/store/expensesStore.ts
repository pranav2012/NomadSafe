import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import { nextRecordId } from "@/utils/recordId";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import type { ExpensePayer, ExpenseShare, ExpenseSplit } from "@/features/expenses/utils/split";
import type { SplitHint } from "@/features/expenses/utils/party";
import { trimStoredEmailRecord } from "@/features/expenses/utils/emailText";

/** "sms" is legacy (device SMS import, removed); kept so stored expenses stay valid. */
/** "forex" spends belong to a forex pocket (fee, untracked cash, leftover, conversion loss or gain) and are edited there. */
export type ExpenseSource = "manual" | "paste" | "sms" | "email" | "voice" | "recurring" | "import" | "forex";

export interface ExpenseLocation {
  latitude: number;
  longitude: number;
  label?: string;
}

export interface Expense {
  id: string;
  /** The trip or group it belongs to; null for spends that aren't in any. */
  groupId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  note?: string;
  date: string;
  source: ExpenseSource;
  location?: ExpenseLocation | null;
  /** Person id (`SELF_ID` or a companion name); unset means the user paid. */
  paidBy?: string;
  /** Set instead of `paidBy` when several people paid; amounts add up to `amount`. */
  payers?: ExpensePayer[];
  /** Unset for personal spends; otherwise sums to `amount`. */
  shares?: ExpenseShare[];
  /** How the split was entered (equal, percent, custom), for editing. */
  split?: ExpenseSplit;
  /** Suggested split from a Gmail booking, waiting for the user; cleared once they save the spend. */
  splitHint?: SplitHint;
  autoCategorized?: boolean;
  rawText?: string;
  /** Stable id of the originating message (e.g. `gmail:<messageId>`) for dedupe. */
  externalId?: string;
  createdAt: string;
}

export interface CreateExpenseInput {
  groupId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  note?: string;
  date: string;
  source: ExpenseSource;
  location?: ExpenseLocation | null;
  paidBy?: string;
  payers?: ExpensePayer[];
  shares?: ExpenseShare[];
  split?: ExpenseSplit;
  splitHint?: SplitHint;
  autoCategorized?: boolean;
  rawText?: string;
  externalId?: string;
}

/** A repayment between two people in a trip or group; `from` paid `to`. */
export interface Settlement {
  id: string;
  groupId: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  date: string;
  source: "manual" | "voice" | "import";
  /** Set on imported payments, so importing the same file again adds nothing. */
  externalId?: string;
  createdAt: string;
}

export type CreateSettlementInput = Omit<Settlement, "id" | "createdAt">;

export type UpdateExpenseInput = Partial<Omit<Expense, "id" | "createdAt">>;

/** Stable fingerprint used to skip importing the same transaction twice. */
export function expenseFingerprint(input: {
  merchant: string;
  amount: number;
  date: string;
}): string {
  const day = toLocalDayKey(input.date);
  const merchant = input.merchant.trim().toLowerCase();
  return `${merchant}|${input.amount.toFixed(2)}|${day}`;
}

export interface DedupeIndex {
  /** Fingerprints of expenses without a source id (manual or legacy imports). */
  fingerprints: Set<string>;
  externalIds: Set<string>;
}

/** Builds lookup sets once per import instead of scanning the ledger per candidate. */
export function buildDedupeIndex(expenses: Expense[]): DedupeIndex {
  const fingerprints = new Set<string>();
  const externalIds = new Set<string>();
  for (const expense of expenses) {
    if (expense.externalId) externalIds.add(expense.externalId);
    else fingerprints.add(expenseFingerprint(expense));
  }
  return { fingerprints, externalIds };
}

interface ExpensesState {
  expenses: Expense[];
  settlements: Settlement[];
  addExpense: (input: CreateExpenseInput) => Expense;
  addExpenses: (inputs: CreateExpenseInput[]) => Expense[];
  updateExpense: (id: string, input: UpdateExpenseInput) => Expense | null;
  /** Applies several updates in one store write. */
  updateExpenses: (updates: { id: string; input: UpdateExpenseInput }[]) => void;
  deleteExpense: (id: string) => void;
  removeExpenses: (ids: string[]) => void;
  removeByGroupId: (groupId: string) => void;
  addSettlement: (input: CreateSettlementInput) => Settlement;
  addSettlements: (inputs: CreateSettlementInput[]) => Settlement[];
  deleteSettlement: (id: string) => void;
  reset: () => void;
}

/** Moves a pre-v2 `tripId` to `groupId` (stored data and old backup records). */
export function withGroupId<T>(record: T): T {
  const legacy = record as T & { tripId?: string | null; groupId?: string | null };
  if (!legacy || typeof legacy !== "object" || !("tripId" in legacy) || "groupId" in legacy) return record;
  const { tripId, ...rest } = legacy;
  return { ...rest, groupId: tripId ?? null } as T;
}

function buildExpense(input: CreateExpenseInput): Expense {
  return {
    ...trimStoredEmailRecord(input),
    id: nextRecordId(),
    createdAt: new Date().toISOString(),
  };
}

export const useExpensesStore = create<ExpensesState>()(
  persist(
    (set, get) => ({
      expenses: [],
      settlements: [],
      addExpense: (input) => {
        const expense = buildExpense(input);
        set((state) => ({ expenses: [expense, ...state.expenses] }));
        return expense;
      },
      addExpenses: (inputs) => {
        // Guards against concurrent imports (sheet + background sync) adding the same message twice.
        const externalIds = new Set(get().expenses.map((expense) => expense.externalId));
        const created = inputs
          .filter((input) => {
            if (!input.externalId) return true;
            if (externalIds.has(input.externalId)) return false;
            externalIds.add(input.externalId);
            return true;
          })
          .map(buildExpense);
        if (created.length === 0) return created;
        set((state) => ({ expenses: [...created, ...state.expenses] }));
        return created;
      },
      updateExpense: (id, input) => {
        let updated: Expense | null = null;
        set((state) => ({
          expenses: state.expenses.map((expense) => {
            if (expense.id !== id) return expense;
            updated = { ...expense, ...input };
            return updated;
          }),
        }));
        return updated;
      },
      updateExpenses: (updates) => {
        if (updates.length === 0) return;
        const byId = new Map(updates.map(({ id, input }) => [id, input]));
        set((state) => ({
          expenses: state.expenses.map((expense) => {
            const input = byId.get(expense.id);
            return input ? { ...expense, ...input } : expense;
          }),
        }));
      },
      deleteExpense: (id) =>
        set((state) => ({
          expenses: state.expenses.filter((expense) => expense.id !== id),
        })),
      removeExpenses: (ids) => {
        if (ids.length === 0) return;
        const remove = new Set(ids);
        set((state) => ({ expenses: state.expenses.filter((expense) => !remove.has(expense.id)) }));
      },
      removeByGroupId: (groupId) =>
        set((state) => ({
          expenses: state.expenses.filter((expense) => expense.groupId !== groupId),
          settlements: state.settlements.filter((settlement) => settlement.groupId !== groupId),
        })),
      addSettlement: (input) => {
        const settlement: Settlement = { ...input, id: nextRecordId(), createdAt: new Date().toISOString() };
        set((state) => ({ settlements: [settlement, ...state.settlements] }));
        return settlement;
      },
      addSettlements: (inputs) => {
        const createdAt = new Date().toISOString();
        const created: Settlement[] = inputs.map((input) => ({ ...input, id: nextRecordId(), createdAt }));
        if (created.length > 0) set((state) => ({ settlements: [...[...created].reverse(), ...state.settlements] }));
        return created;
      },
      deleteSettlement: (id) =>
        set((state) => ({
          settlements: state.settlements.filter((settlement) => settlement.id !== id),
        })),
      reset: () => set({ expenses: [], settlements: [] }),
    }),
    {
      name: "expenses-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as { expenses?: unknown[]; settlements?: unknown[] } | undefined;
        if (!state) return persistedState;
        // v2 renamed tripId to groupId (a trip is a kind of group).
        return {
          ...state,
          expenses: (state.expenses ?? []).map(withGroupId),
          settlements: (state.settlements ?? []).map(withGroupId),
        };
      },
    },
  ),
);
