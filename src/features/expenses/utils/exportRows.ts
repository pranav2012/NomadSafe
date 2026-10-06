import { myShareOf } from "./myMoney";
import { payersOf, SELF_ID, type ExpensePayer, type ExpenseShare } from "./split";

export interface ExportExpense {
  date: string;
  merchant: string;
  category: string;
  amount: number;
  currency: string;
  groupId: string | null;
  paidBy?: string;
  payers?: ExpensePayer[];
  shares?: ExpenseShare[];
  source: string;
}

export interface ExportLabels {
  you: string;
  notInGroup: string;
  headers: [string, string, string, string, string, string, string, string, string];
}

export function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Rows for a spreadsheet: date, description, category, amount, currency, trip or group, who paid,
 * your share and the split. Notes of email imports never go in (they hold the email).
 */
export function exportRows(expenses: ExportExpense[], groupName: (id: string | null) => string, labels: ExportLabels): string[][] {
  const who = (person: string) => (person === SELF_ID ? labels.you : person);
  return [...expenses]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((expense) => [
      expense.date.slice(0, 10),
      expense.merchant,
      expense.category,
      String(expense.amount),
      expense.currency,
      expense.groupId ? groupName(expense.groupId) : labels.notInGroup,
      payersOf(expense)
        .map((payer) => (payersOf(expense).length > 1 ? `${who(payer.person)} ${payer.amount}` : who(payer.person)))
        .join("; "),
      String(Math.round(myShareOf(expense) * 100) / 100),
      (expense.shares ?? []).map((share) => `${who(share.person)} ${share.amount}`).join("; "),
    ]);
}

export function toCsv(rows: string[][], headers: string[]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
