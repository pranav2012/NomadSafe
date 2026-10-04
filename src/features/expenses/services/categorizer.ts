import { aiService } from "@/modules/ai";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import {
  categorizeHeuristic,
  type CategorizerInput,
} from "@/features/expenses/services/categoryHeuristic";

export { categorizeHeuristic };

export interface CategorizeResult {
  category: ExpenseCategory;
  viaModel: boolean;
}

/**
 * Categorizes an expense, preferring the fast keyword heuristic and falling
 * back to the local model only for merchants the heuristic can't place. Imports
 * carry raw email and SMS text, so this never uses online AI. The
 * model is optional: a load or inference failure resolves to the heuristic
 * result with `modelFailed` set so callers can stop consulting it.
 */
export async function categorizeExpense(
  input: CategorizerInput,
): Promise<CategorizeResult & { modelFailed?: boolean }> {
  const heuristic = categorizeHeuristic(input);
  if (heuristic.matched) {
    return { category: heuristic.category, viaModel: false };
  }

  try {
    const modelCategory = await aiService.categorizeExpense(input);
    if (modelCategory) {
      return { category: modelCategory, viaModel: true };
    }
  } catch {
    return { category: heuristic.category, viaModel: false, modelFailed: true };
  }

  return { category: heuristic.category, viaModel: false };
}
