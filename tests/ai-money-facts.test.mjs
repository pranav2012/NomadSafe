import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const en = JSON.parse(readFileSync("src/localization/translations/en.json", "utf8"));

function read(key) {
  return key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), en);
}

function t(key, params = {}) {
  let value;
  if (typeof params.count === "number") {
    const category = new Intl.PluralRules("en").select(params.count);
    value = read(`${key}_${category}`) ?? read(`${key}_other`);
  }
  value ??= read(key);
  if (typeof value !== "string") return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? ""));
}

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

test("matches common money questions", () => {
  const cases = [
    ["How much can I spend per day for the rest of my Lisbon trip?", "dailyBudget"],
    ["What's my daily budget?", "dailyBudget"],
    ["How much do I have left?", "remaining"],
    ["What's left?", "remaining"],
    ["How much have I spent so far?", "spent"],
    ["What's my total spend?", "spent"],
    ["Biggest spending category", "topCategory"],
    ["What did I spend the most on?", "topCategory"],
    ["Am I over budget?", "overBudget"],
    ["Am I on track?", "overBudget"],
  ];
  for (const [question, intent] of cases) {
    assert.equal(money.matchMoneyIntent(question, "Can I afford")?.intent, intent, question);
  }
  assert.equal(money.matchMoneyIntent("Where did I overspend this week?", "Can I afford"), null);
  assert.equal(money.matchMoneyIntent("Best pastel de nata in Lisbon?", "Can I afford"), null);
  assert.equal(money.matchMoneyIntent("Forecast my trip budget", "Can I afford"), null);
});

test("parses afford amounts, including the localized chip prefix", () => {
  assert.deepEqual(money.matchMoneyIntent("Can I afford a $45.50 dinner?", "Can I afford"), {
    intent: "afford",
    amount: 45.5,
  });
  assert.deepEqual(money.matchMoneyIntent("¿Puedo permitirme 1.200,50?", "¿Puedo permitirme"), {
    intent: "afford",
    amount: 1200.5,
  });
  assert.deepEqual(money.matchMoneyIntent("Can I afford a tour?", "Can I afford"), {
    intent: "afford",
    amount: null,
  });
  assert.equal(money.parseAmount("1,200"), 1200);
  assert.equal(money.parseAmount("2k"), 2000);
  assert.equal(money.parseAmount("€12,5"), 12.5);
  assert.equal(money.parseAmount("nothing"), null);
});

test("answers the daily budget question with exact figures", () => {
  const reply = money.answerMoneyIntent({ intent: "dailyBudget", amount: null }, lisbonFacts(), t, "en-US");
  assert.match(reply, /\*\*\$15\.56 per day\*\* for the 6 days left/);
  assert.match(reply, /\$93\.35 you have left/);
  assert.doesNotMatch(reply, /aiTab\./);
});

test("answers remaining, spent, top category, over budget and afford", () => {
  const facts = lisbonFacts();
  const answer = (intent, amount = null) => money.answerMoneyIntent({ intent, amount }, facts, t, "en-US");
  assert.match(answer("remaining"), /\*\*\$93\.35\*\* left of your \$1,500\.50 budget/);
  assert.match(answer("spent"), /\*\*\$1,407\.15\*\* on this trip across 4 expenses/);
  assert.match(answer("topCategory"), /\*\*Stays\*\* at \$700 \(50%/);
  assert.match(answer("overBudget"), /^No\./);
  assert.match(answer("afford", 30), /still have \*\*\$63\.35\*\* left/);
  assert.match(answer("afford", 30), /\$10\.56 per day for the 6 days left/);
  assert.match(answer("afford", 120), /\$26\.65 more than the \$93\.35/);
  assert.match(answer("afford"), /Tell me the amount/);
  for (const intent of ["dailyBudget", "remaining", "spent", "topCategory", "overBudget", "afford"]) {
    assert.doesNotMatch(answer(intent, 10), /aiTab\.|\{\{/, intent);
  }
});

test("handles over budget, ended trips, no budget and no trip", () => {
  const overFacts = lisbonFacts({ expenses: [...expenses, { amount: 200, category: "shopping", merchant: "Loja", date: "2026-09-28" }] });
  assert.equal(overFacts.remaining, -106.65);
  assert.equal(overFacts.safeDailySpend, 0);
  const over = money.answerMoneyIntent({ intent: "dailyBudget", amount: null }, overFacts, t, "en-US");
  assert.match(over, /\*\*\$106\.65 over\*\*/);
  assert.match(money.answerMoneyIntent({ intent: "overBudget", amount: null }, overFacts, t, "en-US"), /^Yes\./);

  const ended = lisbonFacts({ now: new Date(2026, 9, 10) });
  assert.equal(ended.safeDailySpend, null);
  assert.match(money.answerMoneyIntent({ intent: "dailyBudget", amount: null }, ended, t, "en-US"), /has ended with \$93\.35/);

  const noBudget = money.computeMoneyFacts({ trip: { ...lisbon, budget: 0 }, expenses, unconvertedCount: 0, now });
  assert.match(money.answerMoneyIntent({ intent: "remaining", amount: null }, noBudget, t, "en-US"), /no budget set/);
  assert.match(money.answerMoneyIntent({ intent: "remaining", amount: null }, null, t, "en-US"), /create a trip/);

  const withUnconverted = lisbonFacts({ unconvertedCount: 1 });
  assert.match(
    money.answerMoneyIntent({ intent: "spent", amount: null }, withUnconverted, t, "en-US"),
    /1 expense isn't included yet/,
  );
});

test("no-budget trips omit budget facts and answer budget intents with spent so far", () => {
  const facts = money.computeMoneyFacts({ trip: { ...lisbon, budget: 0 }, expenses, unconvertedCount: 0, now });
  assert.equal(facts.hasBudget, false);
  assert.equal(facts.safeDailySpend, null);
  assert.equal(facts.plannedDailyBudget, null);

  const block = money.formatFactsBlock(facts, "en-US", now);
  assert.match(block, /Budget: none set/);
  assert.doesNotMatch(block, /Remaining:|Over budget by:|Safe daily spend|Planned daily budget|\$0\b/);
  assert.match(block, /Spent so far: \$1,407\.15/);

  for (const intent of ["dailyBudget", "remaining", "overBudget", "afford"]) {
    const reply = money.answerMoneyIntent({ intent, amount: 40 }, facts, t, "en-US");
    assert.match(reply, /no budget set/, intent);
    assert.match(reply, /spent \$1,407\.15 so far/, intent);
  }
  assert.match(
    money.answerMoneyIntent({ intent: "spent", amount: null }, facts, t, "en-US"),
    /\*\*\$1,407\.15\*\* on this trip across 4 expenses\. Today so far: \$50\.$/,
  );
  assert.match(money.answerMoneyIntent({ intent: "topCategory", amount: null }, facts, t, "en-US"), /Stays/);
});

test("formats cents only when present", () => {
  assert.equal(money.formatMoney(1500, "USD", "en-US"), "$1,500");
  assert.equal(money.formatMoney(1500.5, "USD", "en-US"), "$1,500.50");
});
