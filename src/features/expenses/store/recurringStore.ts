import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import type { ExpensePayer, ExpenseShare, ExpenseSplit } from "@/features/expenses/utils/split";
import type { RepeatFrequency } from "@/features/expenses/utils/recurring";

/** A spend added again every week, month or year (Plus). Only the phone of whoever set it up adds it. */
export interface RecurringRule {
  id: string;
  groupId: string | null;
  frequency: RepeatFrequency;
  /** Day of the first spend (YYYY-MM-DD); later ones fall on the same weekday or day of the month. */
  startDate: string;
  lastAddedDate: string | null;
  template: {
    merchant: string;
    amount: number;
    currency: string;
    category: ExpenseCategory;
    note?: string;
    paidBy?: string;
    payers?: ExpensePayer[];
    shares?: ExpenseShare[];
    split?: ExpenseSplit;
  };
  createdAt: string;
}

interface RecurringState {
  rules: RecurringRule[];
  add: (rule: Omit<RecurringRule, "id" | "createdAt">) => void;
  update: (id: string, patch: Partial<Omit<RecurringRule, "id">>) => void;
  remove: (id: string) => void;
  removeByGroupId: (groupId: string) => void;
  reset: () => void;
}

export const useRecurringStore = create<RecurringState>()(
  persist(
    (set) => ({
      rules: [],
      add: (rule) =>
        set((state) => ({ rules: [{ ...rule, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() }, ...state.rules] })),
      update: (id, patch) => set((state) => ({ rules: state.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) })),
      remove: (id) => set((state) => ({ rules: state.rules.filter((rule) => rule.id !== id) })),
      removeByGroupId: (groupId) => set((state) => ({ rules: state.rules.filter((rule) => rule.groupId !== groupId) })),
      reset: () => set({ rules: [] }),
    }),
    { name: "recurring-store", storage: createJSONStorage(() => mmkvStateStorage), version: 1, migrate: (persisted) => persisted as RecurringState },
  ),
);
