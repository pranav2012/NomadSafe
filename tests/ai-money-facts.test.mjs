import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

function loadModule(entryPoint) {
  const output = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const money = loadModule("src/features/ai/services/moneyFacts.ts");

const lisbon = {
  name: "Lisbon",
  destinations: ["Lisbon"],
  startDate: "2026-09-22",
  endDate: "2026-10-03",
  budget: 1500.5,
  currency: "USD",
  mode: "solo",
  companions: [],
};

// 2026-09-28 is day 7 of 12, so 6 days are left including today.
const now = new Date(2026, 8, 28, 15, 30);

const expenses = [
  { amount: 700, category: "stays", merchant: "Hotel Avenida", date: "2026-09-22T12:00:00" },
  { amount: 407.15, category: "food", merchant: "Time Out Market", date: "2026-09-25T20:00:00" },
  { amount: 250, category: "travel", merchant: "Uber", date: "2026-09-27T09:00:00" },
  { amount: 50, category: "food", merchant: "time out market ", date: "2026-09-28T13:00:00" },
];

function lisbonFacts(overrides = {}) {
  return money.computeMoneyFacts({ trip: lisbon, expenses, unconvertedCount: 0, now, ...overrides });
}

test("computes the Lisbon safe daily spend exactly", () => {
  const facts = lisbonFacts();
  assert.equal(facts.spent, 1407.15);
  assert.equal(facts.remaining, 93.35);
  assert.equal(facts.totalDays, 12);
  assert.equal(facts.daysElapsed, 7);
  assert.equal(facts.daysLeft, 6);
  assert.equal(facts.safeDailySpend, 15.56);
  assert.equal(facts.todaySpent, 50);
  assert.equal(facts.averageDailySpend, 201.02);
  assert.equal(facts.largestExpense.merchant, "Hotel Avenida");
  assert.deepEqual(
    facts.categories.map((entry) => entry.category),
    ["stays", "food", "travel"],
  );
  assert.equal(facts.merchants[0].merchant, "Hotel Avenida");
  assert.equal(facts.merchants[1].merchant, "Time Out Market");
  assert.equal(facts.merchants[1].count, 2);
  assert.equal(facts.merchants[1].amount, 457.15);
});

test("trip day progress uses inclusive local days", () => {
  assert.deepEqual(money.tripDayProgress(lisbon, new Date(2026, 8, 20)), {
    status: "upcoming",
    totalDays: 12,
    daysElapsed: 0,
    daysLeft: 12,
  });
  assert.deepEqual(money.tripDayProgress(lisbon, new Date(2026, 8, 22, 0, 1)), {
    status: "active",
    totalDays: 12,
    daysElapsed: 1,
    daysLeft: 12,
  });
  assert.deepEqual(money.tripDayProgress(lisbon, new Date(2026, 9, 3, 23, 59)), {
    status: "active",
    totalDays: 12,
    daysElapsed: 12,
    daysLeft: 1,
  });
  assert.equal(money.tripDayProgress(lisbon, new Date(2026, 9, 4)).status, "complete");
});

test("facts block carries verbatim figures and real weekday dates", () => {
  const block = money.formatFactsBlock(lisbonFacts({ unconvertedCount: 2 }), "en-US", now);
  assert.match(block, /Today: Monday, September 28, 2026 \(2026-09-28\)/);
  assert.match(block, /Tuesday, September 22, 2026 to Saturday, October 3, 2026 \(12 days\)/);
  assert.match(block, /Budget: \$1,500\.50/);
  assert.match(block, /Spent so far: \$1,407\.15 across 4 expense/);
  assert.match(block, /Remaining: \$93\.35/);
  assert.match(block, /Safe daily spend for the 6 day\(s\) left: \$15\.56/);
  assert.match(block, /Spent today: \$50\b/);
  assert.match(block, /Not included yet .*: 2 expense/);
  assert.doesNotMatch(block, /Sept 31|September 31/);
});

test("no-budget trips omit budget facts", () => {
  const facts = money.computeMoneyFacts({ trip: { ...lisbon, budget: 0 }, expenses, unconvertedCount: 0, now });
  assert.equal(facts.hasBudget, false);
  assert.equal(facts.safeDailySpend, null);
  assert.equal(facts.plannedDailyBudget, null);

  const block = money.formatFactsBlock(facts, "en-US", now);
  assert.match(block, /Budget: none set/);
  assert.doesNotMatch(block, /Remaining:|Over budget by:|Safe daily spend|Planned daily budget|\$0\b/);
  assert.match(block, /Spent so far: \$1,407\.15/);

});

test("formats cents only when present", () => {
  assert.equal(money.formatMoney(1500, "USD", "en-US"), "$1,500");
  assert.equal(money.formatMoney(1500.5, "USD", "en-US"), "$1,500.50");
});
