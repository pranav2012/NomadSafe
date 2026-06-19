import { localModelService } from "@/features/ai/services/localModelService";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";

interface CategorizerInput {
  merchant: string;
  note?: string;
  rawText?: string;
}

export interface CategorizeResult {
  category: ExpenseCategory;
  viaModel: boolean;
}

const KEYWORDS: Record<Exclude<ExpenseCategory, "other">, string[]> = {
  food: [
    "restaurant", "cafe", "coffee", "starbucks", "mcdonald", "kfc", "domino",
    "pizza", "burger", "bar", "pub", "bistro", "diner", "eatery", "bakery",
    "swiggy", "zomato", "ubereats", "uber eats", "grabfood", "doordash",
    "food", "kitchen", "noodle", "sushi", "deli", "grill", "bun", "chai",
  ],
  stays: [
    "hotel", "hostel", "airbnb", "booking.com", "booking", "agoda", "oyo",
    "resort", "inn", "lodge", "guesthouse", "marriott", "hyatt", "hilton",
    "stay", "accommodation", "rent", "maison",
  ],
  travel: [
    "uber", "ola", "grab", "lyft", "taxi", "cab", "metro", "subway", "train",
    "railway", "irctc", "flight", "airlines", "airways", "airport", "bus",
    "fuel", "petrol", "gas station", "toll", "parking", "rental", "car",
    "transit", "transport", "scooter", "bike",
  ],
  shopping: [
    "amazon", "flipkart", "myntra", "zara", "h&m", "uniqlo", "ikea", "mall",
    "store", "market", "shop", "supermarket", "grocery", "mart", "7-eleven",
    "seven eleven", "decathlon", "electronics", "apparel", "boutique",
    "retail", "duty free", "pharmacy", "chemist",
  ],
};

/**
 * Fast offline categorization by keyword match. `matched` is false when nothing
 * matched, signalling the caller to consult the local model.
 */
export function categorizeHeuristic(input: CategorizerInput): {
  category: ExpenseCategory;
  matched: boolean;
} {
  const haystack = [input.merchant, input.note, input.rawText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const [category, keywords] of Object.entries(KEYWORDS) as [
    Exclude<ExpenseCategory, "other">,
    string[],
  ][]) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return { category, matched: true };
    }
  }

  return { category: "other", matched: false };
}

/**
 * Categorizes an expense, preferring the fast keyword heuristic and falling
 * back to the local model only for merchants the heuristic can't place. The
 * model is optional, so this always resolves to a category.
 */
export async function categorizeExpense(input: CategorizerInput): Promise<CategorizeResult> {
  const heuristic = categorizeHeuristic(input);
  if (heuristic.matched) {
    return { category: heuristic.category, viaModel: false };
  }

  const modelCategory = await localModelService.categorizeExpense(input);
  if (modelCategory) {
    return { category: modelCategory, viaModel: true };
  }

  return { category: "other", viaModel: false };
}
