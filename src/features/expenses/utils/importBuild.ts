import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import { importBalances, type ImportRow, type ParsedImport } from "./importFormats";
import { isEqualSplit, roundMoney, SELF_ID, simplifyDebts, type ExpensePayer, type ExpenseShare, type ExpenseSplit } from "./split";

export type ImportMode = "history" | "balances";

export interface BuiltExpense {
  merchant: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  date: string;
  paidBy?: string;
  payers?: ExpensePayer[];
  shares?: ExpenseShare[];
  split?: ExpenseSplit;
  externalId: string;
}

export interface BuiltSettlement {
  from: string;
  to: string;
  amount: number;
  currency: string;
  date: string;
  externalId: string;
}

export interface ImportOptions {
  mode: ImportMode;
  /** File name -> person in the app (SELF_ID or a companion name). */
  people: Record<string, string>;
  /** Keys of Splitwise rows with no split that the user marked as theirs. */
  mine: Set<string>;
  categorize: (description: string) => ExpenseCategory;
  carriedOver: string;
  today: string;
}

const noon = (day: string) => new Date(`${day}T12:00:00`).toISOString();

function mergeShares(shares: ExpenseShare[]): ExpenseShare[] {
  const byPerson = new Map<string, number>();
  for (const share of shares) byPerson.set(share.person, (byPerson.get(share.person) ?? 0) + share.amount);
  return [...byPerson.entries()].map(([person, amount]) => ({ person, amount: Math.round(amount * 100) / 100 }));
}

function expenseFromRow(row: ImportRow, options: ImportOptions): BuiltExpense {
  const who = (name: string) => options.people[name] ?? name;
  const payers = mergeShares(row.payers.map((payer) => ({ person: who(payer.person), amount: payer.amount })));
  const shares = mergeShares(row.shares.map((share) => ({ person: who(share.person), amount: share.amount })));
  const base = {
    merchant: row.description || options.carriedOver,
    amount: row.amount,
    currency: row.currency,
    category: row.category ?? options.categorize(row.description),
    date: noon(row.date),
    externalId: `import:${row.key}`,
  };
  // A spend only you were part of and paid for is a personal spend, not a split.
  if (payers.length === 0 || (payers.length === 1 && payers[0].person === SELF_ID && shares.every((share) => share.person === SELF_ID))) return base;
  return {
    ...base,
    ...(payers.length > 1 ? { payers } : payers[0].person === SELF_ID ? {} : { paidBy: payers[0].person }),
    shares,
    split: { mode: isEqualSplit(shares, row.currency) ? "equal" : "custom" },
  };
}

/** Expenses and payments to add for an import: every row, or one "carried over" entry per debt. */
export function buildImport(parsed: ParsedImport, options: ImportOptions): { expenses: BuiltExpense[]; settlements: BuiltSettlement[] } {
  const who = (name: string) => options.people[name] ?? name;
  if (options.mode === "balances") {
    const byCurrency = new Map<string, Map<string, number>>();
    for (const [name, balances] of Object.entries(importBalances(parsed.rows))) {
      for (const [currency, value] of Object.entries(balances)) {
        const net = byCurrency.get(currency) ?? new Map<string, number>();
        net.set(who(name), (net.get(who(name)) ?? 0) + value);
        byCurrency.set(currency, net);
      }
    }
    const expenses: BuiltExpense[] = [];
    for (const [currency, net] of byCurrency) {
      for (const transfer of simplifyDebts(net, currency)) {
        const amount = roundMoney(transfer.amount, currency);
        expenses.push({
          merchant: options.carriedOver,
          amount,
          currency,
          category: "other",
          date: noon(options.today),
          ...(transfer.to === SELF_ID ? {} : { paidBy: transfer.to }),
          shares: [{ person: transfer.from, amount }],
          split: { mode: "custom" },
          externalId: `import:${parsed.source}:balance:${options.today}:${currency}:${transfer.from}:${transfer.to}`,
        });
      }
    }
    return { expenses, settlements: [] };
  }
  const expenses: BuiltExpense[] = [];
  const settlements: BuiltSettlement[] = [];
  for (const row of parsed.rows) {
    if (row.kind === "payment") {
      settlements.push({ from: who(row.payers[0].person), to: who(row.shares[0].person), amount: row.amount, currency: row.currency, date: noon(row.date), externalId: `import:${row.key}` });
    } else if (row.kind === "personal") {
      if (options.mine.has(row.key)) expenses.push(expenseFromRow(row, options));
    } else {
      expenses.push(expenseFromRow(row, options));
    }
  }
  return { expenses, settlements };
}
