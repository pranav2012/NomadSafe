# Phase 3: Expense Tracking & Cost Splitting

## Overview

This phase adds expense tracking tied to trips — personal expenses for solo trips, shared expenses with cost splitting for group trips. Includes category system, settlement calculations (who owes whom), receipt photo attachments via Convex file storage, expense summaries with charts, and CSV/PDF export.

## Dependencies

- Phase 1 (design system, auth, Convex, storage)
- Phase 2 (trips, trip members — expenses belong to trips, splits reference members)

---

## Step 1: Install Packages

```bash
npx expo install expo-file-system expo-sharing expo-image-picker
pnpm add react-native-svg
```

- `expo-file-system` — write CSV/PDF export files
- `expo-sharing` — share exported files
- `expo-image-picker` — capture/select receipt photos
- `react-native-svg` — SVG-based charts (pie chart, bar chart)

---

## Step 2: Convex Schema Additions

### convex/schema.ts (MODIFY)

```typescript
expenses: defineTable({
  tripId: v.id("trips"),
  title: v.string(),
  amount: v.number(),
  currency: v.string(),
  category: v.string(),                    // ExpenseCategory key
  paidByMemberId: v.id("tripMembers"),
  splitType: v.union(
    v.literal("equal"),
    v.literal("percentage"),
    v.literal("exact"),
    v.literal("none")                      // solo trips — no split
  ),
  splits: v.array(v.object({
    memberId: v.id("tripMembers"),
    amount: v.number(),
    percentage: v.optional(v.number()),
    isPaid: v.boolean(),
  })),
  notes: v.string(),
  receiptStorageId: v.optional(v.id("_storage")),
  date: v.string(),                        // ISO 8601 date
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_trip", ["tripId"])
  .index("by_trip_date", ["tripId", "date"])
  .index("by_trip_category", ["tripId", "category"])
  .index("by_payer", ["paidByMemberId"]),

settlements: defineTable({
  tripId: v.id("trips"),
  fromMemberId: v.id("tripMembers"),
  toMemberId: v.id("tripMembers"),
  amount: v.number(),
  currency: v.string(),
  isSettled: v.boolean(),
  settledAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_trip", ["tripId"])
  .index("by_from", ["fromMemberId"])
  .index("by_to", ["toMemberId"]),
```

---

## Step 3: TypeScript Types

### types/expense.ts

```typescript
import type { Id } from "@/convex/_generated/dataModel";

export type SplitType = "equal" | "percentage" | "exact" | "none";

export type ExpenseCategory =
  | "food"
  | "transport"
  | "accommodation"
  | "entertainment"
  | "shopping"
  | "health"
  | "communication"
  | "activities"
  | "tips"
  | "other";

export interface CategoryMeta {
  key: ExpenseCategory;
  label: string;
  icon: string;       // Ionicons name
  color: string;      // hex color
}

export interface ExpenseSplit {
  memberId: Id<"tripMembers">;
  amount: number;
  percentage?: number;
  isPaid: boolean;
}

export interface Expense {
  _id: Id<"expenses">;
  tripId: Id<"trips">;
  title: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  paidByMemberId: Id<"tripMembers">;
  splitType: SplitType;
  splits: ExpenseSplit[];
  notes: string;
  receiptStorageId?: Id<"_storage">;
  date: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settlement {
  _id: Id<"settlements">;
  tripId: Id<"trips">;
  fromMemberId: Id<"tripMembers">;
  toMemberId: Id<"tripMembers">;
  amount: number;
  currency: string;
  isSettled: boolean;
  settledAt?: number;
  createdAt: number;
}
```

---

## Step 4: Category Registry

### constants/categories.ts

```typescript
export const EXPENSE_CATEGORIES: CategoryMeta[] = [
  { key: "food",           label: "Food & Drinks",   icon: "restaurant-outline",   color: "#FF6B6B" },
  { key: "transport",      label: "Transport",        icon: "car-outline",          color: "#4ECDC4" },
  { key: "accommodation",  label: "Accommodation",    icon: "bed-outline",          color: "#45B7D1" },
  { key: "entertainment",  label: "Entertainment",    icon: "musical-notes-outline",color: "#96CEB4" },
  { key: "shopping",       label: "Shopping",         icon: "bag-outline",          color: "#DDA0DD" },
  { key: "health",         label: "Health",           icon: "medkit-outline",       color: "#FF9500" },
  { key: "communication",  label: "Communication",    icon: "call-outline",         color: "#85C1E9" },
  { key: "activities",     label: "Activities",       icon: "compass-outline",      color: "#F0B27A" },
  { key: "tips",           label: "Tips",             icon: "heart-outline",        color: "#BB8FCE" },
  { key: "other",          label: "Other",            icon: "ellipsis-horizontal-outline", color: "#9CA3AF" },
];

export const getCategoryMeta = (key: ExpenseCategory): CategoryMeta =>
  EXPENSE_CATEGORIES.find((c) => c.key === key) ?? EXPENSE_CATEGORIES[9];
```

---

## Step 5: Settlement Algorithm

### services/splitCalculator.ts

**Minimum cash flow algorithm:**

```typescript
interface NetBalance {
  memberId: string;
  memberName: string;
  balance: number; // positive = owed money (creditor), negative = owes money (debtor)
}

interface SettlementResult {
  fromMemberId: string;
  fromMemberName: string;
  toMemberId: string;
  toMemberName: string;
  amount: number;
}

/**
 * Calculates minimal set of transactions to settle all debts.
 *
 * Algorithm:
 * 1. For each member: net balance = total paid - total owed
 * 2. Separate into creditors (positive) and debtors (negative)
 * 3. Sort both by absolute amount descending
 * 4. Match largest debtor with largest creditor
 * 5. Create settlement for min(|debtor|, |creditor|)
 * 6. Reduce both, re-sort, repeat until all balanced
 */
export function calculateSettlements(
  expenses: Expense[],
  members: TripMember[]
): SettlementResult[] {
  // Step 1: Compute net balances
  const balances = new Map<string, number>();
  members.forEach((m) => balances.set(m._id, 0));

  for (const expense of expenses) {
    // Payer gets credited
    const current = balances.get(expense.paidByMemberId) ?? 0;
    balances.set(expense.paidByMemberId, current + expense.amount);

    // Each split participant gets debited
    for (const split of expense.splits) {
      const memberBalance = balances.get(split.memberId) ?? 0;
      balances.set(split.memberId, memberBalance - split.amount);
    }
  }

  // Step 2: Separate creditors and debtors
  const creditors: { id: string; amount: number }[] = [];
  const debtors: { id: string; amount: number }[] = [];

  balances.forEach((balance, id) => {
    if (balance > 0.01) creditors.push({ id, amount: balance });
    else if (balance < -0.01) debtors.push({ id, amount: Math.abs(balance) });
  });

  // Step 3-6: Greedy matching
  const settlements: SettlementResult[] = [];

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const settleAmount = Math.min(creditors[ci].amount, debtors[di].amount);

    const fromMember = members.find((m) => m._id === debtors[di].id)!;
    const toMember = members.find((m) => m._id === creditors[ci].id)!;

    settlements.push({
      fromMemberId: debtors[di].id,
      fromMemberName: fromMember.name,
      toMemberId: creditors[ci].id,
      toMemberName: toMember.name,
      amount: Math.round(settleAmount * 100) / 100,
    });

    creditors[ci].amount -= settleAmount;
    debtors[di].amount -= settleAmount;

    if (creditors[ci].amount < 0.01) ci++;
    if (debtors[di].amount < 0.01) di++;
  }

  return settlements;
}
```

**Split computation helpers:**

```typescript
// computeEqualSplit(amount, memberIds) → ExpenseSplit[]
// Each member gets amount / memberCount, with rounding correction on last member

// computePercentageSplit(amount, percentages: {memberId, percentage}[]) → ExpenseSplit[]
// Each member gets (amount * percentage / 100), verify percentages sum to 100

// computeExactSplit(amounts: {memberId, amount}[]) → ExpenseSplit[]
// Verify amounts sum to total
```

---

## Step 6: Convex Functions

### convex/expenses.ts

**Queries:**
```typescript
// getExpensesByTrip — all expenses for a trip, sorted by date desc
// getExpenseById — single expense with receipt URL
// getTripExpenseSummary — total, by-category breakdown, daily averages
// getSettlements — settlements for a trip
```

**Mutations:**
```typescript
// createExpense — create expense with splits
//   For solo trips: splitType = "none", splits = [{ memberId: owner, amount: total, isPaid: true }]
//   For group trips: compute splits based on splitType
// updateExpense — update expense details, recompute splits
// deleteExpense — delete expense
// markSettled — mark a settlement as paid
// generateUploadUrl — get Convex storage upload URL for receipt
```

**Receipt upload pattern:**
```typescript
// Client-side:
// 1. Call generateUploadUrl mutation to get upload URL
// 2. Upload image directly to Convex storage via fetch POST
// 3. Get storageId from response
// 4. Pass storageId when creating/updating expense

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getReceiptUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    return await ctx.storage.getUrl(storageId);
  },
});
```

---

## Step 7: Zustand Store

### stores/expenseStore.ts

```typescript
interface ExpenseState {
  expenses: Record<string, Expense>;
  isLoading: boolean;

  setExpenses: (tripId: string, expenses: Expense[]) => void;
  addExpenseOptimistic: (expense: Expense) => void;
  removeExpenseOptimistic: (id: string) => void;
  updateExpenseOptimistic: (id: string, updates: Partial<Expense>) => void;
  setLoading: (value: boolean) => void;
}

// Selectors
export const selectExpensesByTrip = (tripId: string) => (state: ExpenseState) =>
  Object.values(state.expenses)
    .filter((e) => e.tripId === tripId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

export const selectTripTotal = (tripId: string) => (state: ExpenseState) =>
  Object.values(state.expenses)
    .filter((e) => e.tripId === tripId)
    .reduce((sum, e) => sum + e.amount, 0);

export const selectCategoryBreakdown = (tripId: string) => (state: ExpenseState) => {
  const expenses = Object.values(state.expenses).filter((e) => e.tripId === tripId);
  const breakdown: Record<string, number> = {};
  for (const e of expenses) {
    breakdown[e.category] = (breakdown[e.category] ?? 0) + e.amount;
  }
  return breakdown;
};

export const selectDailyAverage = (tripId: string) => (state: ExpenseState) => {
  const expenses = Object.values(state.expenses).filter((e) => e.tripId === tripId);
  if (expenses.length === 0) return 0;
  const dates = new Set(expenses.map((e) => e.date));
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  return total / dates.size;
};
```

---

## Step 8: Export Service

### services/exportService.ts

```typescript
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function exportToCSV(
  expenses: Expense[],
  members: TripMember[],
  tripTitle: string
): Promise<void> {
  const header = "Date,Title,Category,Amount,Currency,Paid By,Split Type,Notes\n";
  const rows = expenses.map((e) => {
    const payer = members.find((m) => m._id === e.paidByMemberId)?.name ?? "Unknown";
    return `${e.date},"${e.title}",${e.category},${e.amount},${e.currency},"${payer}",${e.splitType},"${e.notes}"`;
  }).join("\n");

  const csv = header + rows;
  const fileName = `${tripTitle.replace(/\s+/g, "_")}_expenses.csv`;
  const filePath = `${FileSystem.documentDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(filePath, csv);
  await Sharing.shareAsync(filePath, { mimeType: "text/csv" });
}

export async function exportToPDF(
  expenses: Expense[],
  settlements: SettlementResult[],
  members: TripMember[],
  tripTitle: string,
  currency: string
): Promise<void> {
  // Generate HTML string with styled expense table + settlement summary
  // Use expo-print (if available) or create a simple HTML file
  // Convert to PDF or share HTML directly
  // For MVP: share as HTML; PDF generation can be enhanced later
}
```

---

## Step 9: Currency Utilities

### utils/currency.ts

```typescript
// formatCurrency(amount, currencyCode) → "$1,234.56" or "€1.234,56"
// Uses Intl.NumberFormat

export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Common currencies list for picker
export const CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  // ... more as needed
];
```

---

## Step 10: File Structure (New Files)

```
app/
├── (tabs)/
│   └── expenses.tsx                   (MODIFY — global expense overview)
├── trip/
│   └── [id]/
│       ├── expenses.tsx               (trip expense list)
│       ├── summary.tsx                (charts, category breakdown, export)
│       └── expense/
│           ├── create.tsx             (add/edit expense form)
│           ├── [expenseId].tsx        (expense detail)
│           └── settle.tsx             (settlement view)
components/
├── expenses/
│   ├── ExpenseCard.tsx
│   ├── ExpenseForm.tsx
│   ├── CategoryPicker.tsx
│   ├── SplitSelector.tsx
│   ├── PayerSelector.tsx
│   ├── SettlementCard.tsx
│   ├── ExpenseSummary.tsx
│   └── AmountInput.tsx
stores/
├── expenseStore.ts
types/
├── expense.ts
services/
├── splitCalculator.ts
├── exportService.ts
constants/
├── categories.ts
utils/
├── currency.ts
convex/
├── expenses.ts
├── schema.ts                          (MODIFY)
```

---

## Step 11: Screen Specs

### app/trip/[id]/expenses.tsx — Trip Expense List

- Header: "Expenses" with total amount and "+" add button
- Category filter chips (optional, scrollable)
- FlatList of ExpenseCard, grouped by date
- Floating "Add Expense" button
- Tap card → navigate to expense detail

### app/trip/[id]/expense/create.tsx — Add/Edit Expense

- Amount input (large, prominent, with currency symbol)
- Title input
- Category picker (grid of category icons — CategoryPicker component)
- Date picker
- For group trips:
  - Payer selector (PayerSelector — who paid)
  - Split type selector (SplitSelector — equal/percentage/exact)
  - Split details based on type
- Notes input (multiline)
- "Add Receipt" button (opens expo-image-picker)
- Receipt preview (if attached)
- "Save" button

### app/trip/[id]/expense/[expenseId].tsx — Expense Detail

- Full expense details display
- Receipt image (full-size, tappable to zoom)
- Split breakdown (who owes what)
- Edit / Delete buttons

### app/trip/[id]/expense/settle.tsx — Settlement View

- "Who owes whom" list (SettlementCard components)
- Each card: "Alice owes Bob $50.00" with "Mark as Settled" button
- Total outstanding amount at top
- Settled items greyed out with checkmark

### app/trip/[id]/summary.tsx — Expense Summary

- Total spent (large number)
- Pie chart: category breakdown (react-native-svg)
- Bar chart: daily spending
- Top categories list with amounts
- Per-member spending breakdown
- Export buttons: "Export CSV" / "Export PDF"

### app/(tabs)/expenses.tsx — Global Expense Overview

- Monthly spending total across all trips
- Recent expenses (last 10 across all trips)
- Per-trip totals
- Navigate to individual trip expense views

---

## Step 12: Component Specs

### ExpenseCard
| Prop | Type |
|------|------|
| expense | Expense |
| memberName | string (payer name) |
| onPress | () => void |

Shows: category icon + color, title, amount, payer name, date.

### ExpenseForm
| Prop | Type |
|------|------|
| tripId | string |
| members | TripMember[] |
| isGroup | boolean |
| initialValues | Partial\<Expense\> |
| onSubmit | (data) => void |
| isLoading | boolean |

Handles form state, validation, split computation.

### CategoryPicker
| Prop | Type |
|------|------|
| selected | ExpenseCategory |
| onSelect | (category: ExpenseCategory) => void |

Grid of category icons (2 rows x 5 columns). Selected item has colored background.

### SplitSelector
| Prop | Type |
|------|------|
| splitType | SplitType |
| members | TripMember[] |
| totalAmount | number |
| onSplitChange | (splits: ExpenseSplit[]) => void |

Three tabs: Equal | Percentage | Exact.
- Equal: shows per-person amount (auto-calculated)
- Percentage: slider or input per member (must sum to 100%)
- Exact: amount input per member (must sum to total)

### PayerSelector
| Prop | Type |
|------|------|
| members | TripMember[] |
| selectedId | string |
| onSelect | (memberId: string) => void |

Horizontal scrollable avatar row. Tap to select payer.

### SettlementCard
| Prop | Type |
|------|------|
| settlement | SettlementResult |
| isSettled | boolean |
| onMarkSettled | () => void |

Card showing: "From → To: amount" with settle button.

### ExpenseSummary
| Prop | Type |
|------|------|
| expenses | Expense[] |
| members | TripMember[] |
| currency | string |

Renders pie chart + stats. Uses react-native-svg for charts.

### AmountInput
| Prop | Type |
|------|------|
| value | string |
| onChangeText | (text: string) => void |
| currency | string |

Large numeric input with currency symbol prefix. Formats as user types (adds decimal point, thousand separators).

---

## Step-by-Step Build Order

1. [ ] Add expenses and settlements tables to `convex/schema.ts`
2. [ ] Create `convex/expenses.ts` (queries, mutations, file upload)
3. [ ] Deploy schema: `npx convex dev`
4. [ ] Create `types/expense.ts`
5. [ ] Create `constants/categories.ts`
6. [ ] Create `utils/currency.ts`
7. [ ] Create `services/splitCalculator.ts` (settlement algorithm + split helpers)
8. [ ] Create `services/exportService.ts`
9. [ ] Create `stores/expenseStore.ts`
10. [ ] Create `components/expenses/AmountInput.tsx`
11. [ ] Create `components/expenses/CategoryPicker.tsx`
12. [ ] Create `components/expenses/PayerSelector.tsx`
13. [ ] Create `components/expenses/SplitSelector.tsx`
14. [ ] Create `components/expenses/ExpenseCard.tsx`
15. [ ] Create `components/expenses/ExpenseForm.tsx`
16. [ ] Create `components/expenses/SettlementCard.tsx`
17. [ ] Create `components/expenses/ExpenseSummary.tsx`
18. [ ] Create `app/trip/[id]/expenses.tsx`
19. [ ] Create `app/trip/[id]/expense/create.tsx`
20. [ ] Create `app/trip/[id]/expense/[expenseId].tsx`
21. [ ] Create `app/trip/[id]/expense/settle.tsx`
22. [ ] Create `app/trip/[id]/summary.tsx`
23. [ ] Modify `app/(tabs)/expenses.tsx` — global overview
24. [ ] Wire up Convex sync → expenseStore
25. [ ] Implement receipt photo upload (expo-image-picker → Convex storage)
26. [ ] Test: solo trip — add expense (no split) → detail → summary
27. [ ] Test: group trip — add expense with equal split → settlement view correct
28. [ ] Test: group trip — percentage and exact splits
29. [ ] Test: settlement algorithm with 4+ members and 10+ expenses
30. [ ] Test: mark settlement as paid
31. [ ] Test: export CSV → file opens in share sheet
32. [ ] Test: receipt photo capture and display
33. [ ] Run `pnpm lint`

---

## Verification

1. Solo trip: add 5 expenses across categories → summary shows correct pie chart
2. Group trip (3 members): add 8 expenses with different payers → settlements are correct and minimal
3. Equal split: $30 among 3 = $10 each
4. Percentage split: 50% / 30% / 20% of $100 = $50 / $30 / $20
5. Exact split: custom amounts summing to total
6. Receipt photo attaches to expense and displays in detail view
7. CSV export contains all expense data in correct format
8. Settlement "Mark as Settled" works and updates UI
9. Global expenses tab shows cross-trip totals
10. Real-time: add expense on one device → appears on another
