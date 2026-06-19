import type { NomadColors } from "@/constants/theme";
import type { IconName } from "@/components/nomad/Icon";

export type ExpenseCategory =
  | "food"
  | "stays"
  | "travel"
  | "shopping"
  | "other";

export interface CategoryMeta {
  id: ExpenseCategory;
  color: keyof NomadColors;
  soft: keyof NomadColors;
  icon: IconName;
}

export const EXPENSE_CATEGORIES: CategoryMeta[] = [
  { id: "food", color: "stamp", soft: "stampSoft", icon: "utensils" },
  { id: "stays", color: "teal", soft: "tealSoft", icon: "building" },
  { id: "travel", color: "mustard", soft: "mustardSoft", icon: "car" },
  { id: "shopping", color: "sky", soft: "skySoft", icon: "wallet" },
  { id: "other", color: "inkMuted", soft: "hairline", icon: "receipt" },
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
