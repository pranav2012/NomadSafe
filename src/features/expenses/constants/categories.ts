import type { IconName } from "@/atoms";

export type ExpenseCategory =
  | "food"
  | "stays"
  | "travel"
  | "shopping"
  | "other";

export interface CategoryMeta {
  id: ExpenseCategory;
  icon: IconName;
}

export const EXPENSE_CATEGORIES: CategoryMeta[] = [
  { id: "food", icon: "utensils" },
  { id: "stays", icon: "building" },
  { id: "travel", icon: "car" },
  { id: "shopping", icon: "wallet" },
  { id: "other", icon: "receipt" },
];

export const EXPENSE_CATEGORY_IDS = EXPENSE_CATEGORIES.map((c) => c.id);

const CATEGORY_BY_ID: Record<ExpenseCategory, CategoryMeta> = EXPENSE_CATEGORIES.reduce(
  (acc, meta) => {
    acc[meta.id] = meta;
    return acc;
  },
  {} as Record<ExpenseCategory, CategoryMeta>,
);

export function getCategoryMeta(id: ExpenseCategory): CategoryMeta {
  return CATEGORY_BY_ID[id] ?? CATEGORY_BY_ID.other;
}

export function isExpenseCategory(value: string): value is ExpenseCategory {
  return value in CATEGORY_BY_ID;
}
