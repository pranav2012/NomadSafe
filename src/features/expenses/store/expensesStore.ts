import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import type { ExpenseShare } from "@/features/expenses/utils/split";
import type { SplitHint } from "@/features/expenses/utils/party";

/** "sms" is legacy (device SMS import, removed); kept so stored expenses stay valid. */
export type ExpenseSource = "manual" | "paste" | "sms" | "email" | "voice";

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
  /** Unset for personal spends; otherwise sums to `amount`. */
  shares?: ExpenseShare[];
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
  shares?: ExpenseShare[];
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
  source: "manual" | "voice";
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
  deleteExpense: (id: string) => void;
  removeByGroupId: (groupId: string) => void;
  addSettlement: (input: CreateSettlementInput) => Settlement;
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

let idCounter = 0;
// The random part keeps ids unique across phones, since shared trips mix records from several members.
function nextId(): string {
  idCounter += 1;
  return `${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildExpense(input: CreateExpenseInput): Expense {
  return {
    ...input,
    id: nextId(),
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
      deleteExpense: (id) =>
        set((state) => ({
          expenses: state.expenses.filter((expense) => expense.id !== id),
        })),
      removeByGroupId: (groupId) =>
        set((state) => ({
          expenses: state.expenses.filter((expense) => expense.groupId !== groupId),
          settlements: state.settlements.filter((settlement) => settlement.groupId !== groupId),
        })),
      addSettlement: (input) => {
        const settlement: Settlement = { ...input, id: nextId(), createdAt: new Date().toISOString() };
        set((state) => ({ settlements: [settlement, ...state.settlements] }));
        return settlement;
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
