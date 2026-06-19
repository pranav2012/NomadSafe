import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";

export type ExpenseSource = "manual" | "sms" | "email";

export interface ExpenseLocation {
  latitude: number;
  longitude: number;
  label?: string;
}

export interface Expense {
  id: string;
  tripId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  note?: string;
  date: string;
  source: ExpenseSource;
  location?: ExpenseLocation | null;
  splitWith?: string[];
  autoCategorized?: boolean;
  rawText?: string;
  /** Stable id of the originating message (e.g. `gmail:<messageId>`) for dedupe. */
  externalId?: string;
  createdAt: string;
}

export interface CreateExpenseInput {
  tripId: string | null;
  merchant: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  note?: string;
  date: string;
  source: ExpenseSource;
  location?: ExpenseLocation | null;
  splitWith?: string[];
  autoCategorized?: boolean;
  rawText?: string;
  externalId?: string;
}

export type UpdateExpenseInput = Partial<Omit<Expense, "id" | "createdAt">>;

/** Stable fingerprint used to skip importing the same transaction twice. */
export function expenseFingerprint(input: {
  merchant: string;
  amount: number;
  date: string;
}): string {
  const day = input.date.slice(0, 10);
  const merchant = input.merchant.trim().toLowerCase();
  return `${merchant}|${input.amount.toFixed(2)}|${day}`;
}

interface ExpensesState {
  expenses: Expense[];
  addExpense: (input: CreateExpenseInput) => Expense;
  addExpenses: (inputs: CreateExpenseInput[]) => Expense[];
  updateExpense: (id: string, input: UpdateExpenseInput) => Expense | null;
  deleteExpense: (id: string) => void;
  hasFingerprint: (fingerprint: string) => boolean;
  hasExternalId: (externalId: string) => boolean;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `${Date.now()}-${idCounter}`;
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
      addExpense: (input) => {
        const expense = buildExpense(input);
        set((state) => ({ expenses: [expense, ...state.expenses] }));
        return expense;
      },
      addExpenses: (inputs) => {
        const created = inputs.map(buildExpense);
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
      hasFingerprint: (fingerprint) =>
        get().expenses.some(
          (expense) =>
            expenseFingerprint({
              merchant: expense.merchant,
              amount: expense.amount,
              date: expense.date,
            }) === fingerprint,
        ),
      hasExternalId: (externalId) =>
        get().expenses.some((expense) => expense.externalId === externalId),
    }),
    {
      name: "expenses-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 1,
    },
  ),
);
