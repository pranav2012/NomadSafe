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

const split = loadModule("src/features/expenses/utils/split.ts");
const voice = loadModule("src/features/expenses/services/voiceExpense.ts");
const { SELF_ID } = split;
const same = () => 1;

test("equal split gives leftover minor units to the first people", () => {
  assert.deepEqual(split.splitEqually(100, "USD", [SELF_ID, "Raj", "Priya"]), [
    { person: SELF_ID, amount: 33.34 },
    { person: "Raj", amount: 33.33 },
    { person: "Priya", amount: 33.33 },
  ]);
  assert.deepEqual(split.splitEqually(500, "JPY", ["a", "b", "c"]).map((s) => s.amount), [167, 167, 166]);
});

test("explicit shares take their amount and the rest is split equally", () => {
  const result = split.resolveShares(500, "INR", [SELF_ID, "Raj", "Priya"], [{ person: "Raj", amount: 200 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.shares, [
    { person: SELF_ID, amount: 150 },
    { person: "Raj", amount: 200 },
    { person: "Priya", amount: 150 },
  ]);
});

test("explicit shares that don't add up are rejected", () => {
  assert.deepEqual(split.resolveShares(500, "INR", [], [{ person: "Raj", amount: 600 }]), {
    ok: false,
    reason: "over-total",
  });
  assert.deepEqual(
    split.resolveShares(500, "INR", ["Raj"], [{ person: "Raj", amount: 300 }]),
    { ok: false, reason: "under-total" },
  );
});

test("balances net out payments, shares and settlements", () => {
  const expenses = [
    {
      amount: 900,
      currency: "INR",
      date: "2026-09-28T10:00:00Z",
      paidBy: SELF_ID,
      shares: split.splitEqually(900, "INR", [SELF_ID, "Raj", "Priya"]),
    },
    {
      amount: 300,
      currency: "INR",
      date: "2026-09-28T12:00:00Z",
      paidBy: "Raj",
      shares: split.splitEqually(300, "INR", [SELF_ID, "Raj"]),
    },
    { amount: 50, currency: "INR", date: "2026-09-28T12:00:00Z" },
  ];
  const settlements = [{ from: "Priya", to: SELF_ID, amount: 100, currency: "INR", date: "2026-09-29T00:00:00Z" }];
  const { net, unconverted } = split.computeNetBalances(expenses, settlements, same);
  assert.equal(unconverted, 0);
  assert.equal(net.get(SELF_ID), 900 - 300 - 150 - 100);
  assert.equal(net.get("Raj"), -300 + 300 - 150);
  assert.equal(net.get("Priya"), -300 + 100);

  assert.deepEqual(split.simplifyDebts(net, "INR"), [
    { from: "Priya", to: SELF_ID, amount: 200 },
    { from: "Raj", to: SELF_ID, amount: 150 },
  ]);
});

test("expenses without a rate are counted as unconverted", () => {
  const expenses = [
    { amount: 10, currency: "EUR", date: "2026-09-28", paidBy: SELF_ID, shares: [{ person: "Raj", amount: 10 }] },
  ];
  const { net, unconverted } = split.computeNetBalances(expenses, [], () => null);
  assert.equal(unconverted, 1);
  assert.equal(net.size, 0);
});

test("spoken names match companions despite recognizer spelling", () => {
  const companions = ["Raj Kumar", "Priya", "Ananya"];
  assert.equal(split.matchCompanion("raj", companions), "Raj Kumar");
  assert.equal(split.matchCompanion("Pria", companions), "Priya");
  assert.equal(split.matchCompanion("Annanya", companions), "Ananya");
  assert.equal(split.matchCompanion("Vikram", companions), null);
  assert.equal(split.isSelfWord("Me"), true);
});

const baseExtraction = {
  intent: "expense",
  amount: 500,
  currency: "",
  description: "dinner",
  category: "food",
  paid_by: "me",
  split_with: [],
  everyone: false,
  include_me: true,
  fixed_shares: [],
  repayment_from: "",
  repayment_to: "",
  days_ago: 0,
};
const context = { companions: ["Raj", "Priya"], tripCurrency: "INR", now: new Date("2026-09-29T12:00:00Z") };

test("voice: split with named people includes the speaker and flags strangers", () => {
  const draft = voice.interpretVoiceExtraction(
    { ...baseExtraction, split_with: ["Raaj", "Vikram"] },
    "I paid 500 for dinner split with Raaj and Vikram",
    context,
  );
  assert.equal(draft.kind, "expense");
  assert.equal(draft.currency, "INR");
  assert.equal(draft.merchant, "Dinner");
  assert.deepEqual(draft.people.sort(), [SELF_ID, "Raj", "Vikram"].sort());
  assert.deepEqual(draft.unknownNames, ["Vikram"]);
  assert.equal(draft.amountUncertain, false);

  const withoutStranger = voice.replaceDraftPerson(draft, "Vikram", null);
  assert.deepEqual(withoutStranger.people.sort(), [SELF_ID, "Raj"].sort());
  assert.deepEqual(withoutStranger.unknownNames, []);
});

test("voice: everyone, other payer, currency and yesterday", () => {
  const draft = voice.interpretVoiceExtraction(
    { ...baseExtraction, paid_by: "Priya", everyone: true, currency: "usd", days_ago: 1 },
    "Priya paid 500 dollars for the taxi yesterday for everyone",
    context,
  );
  assert.equal(draft.paidBy, "Priya");
  assert.equal(draft.currency, "USD");
  assert.deepEqual(draft.people.sort(), [SELF_ID, "Priya", "Raj"].sort());
  assert.equal(draft.date.slice(0, 10), "2026-09-28");
});

test("voice: someone else paying with no split means they covered the speaker", () => {
  const draft = voice.interpretVoiceExtraction({ ...baseExtraction, paid_by: "Raj" }, "Raj paid 500 for my lunch", context);
  assert.deepEqual(draft.people, [SELF_ID]);
});

test("voice: an amount that wasn't heard is uncertain", () => {
  const draft = voice.interpretVoiceExtraction({ ...baseExtraction, amount: 50 }, "paid 500 for dinner", context);
  assert.equal(draft.amountUncertain, true);
});

test("voice: repayments become settlements", () => {
  const draft = voice.interpretVoiceExtraction(
    { ...baseExtraction, intent: "repayment", amount: 300, repayment_from: "Raj", repayment_to: "me" },
    "Raj paid me back 300",
    context,
  );
  assert.equal(draft.kind, "settlement");
  assert.equal(draft.from, "Raj");
  assert.equal(draft.to, SELF_ID);
});

test("voice: unclear or zero amounts are unclear", () => {
  assert.equal(voice.interpretVoiceExtraction({ ...baseExtraction, amount: 0 }, "hello", context).kind, "unclear");
  assert.equal(voice.interpretVoiceExtraction(null, "hello", context).kind, "unclear");
});

test("percent split rounds in minor units and always adds up to the total", () => {
  const result = split.splitByPercent(100, "USD", { [SELF_ID]: 60, Raj: 40 });
  assert.deepEqual(result, { ok: true, shares: [{ person: SELF_ID, amount: 60 }, { person: "Raj", amount: 40 }] });
  const thirds = split.splitByPercent(100, "USD", { a: 33.33, b: 33.33, c: 33.34 });
  assert.equal(thirds.ok, true);
  assert.equal(Math.round(thirds.shares.reduce((sum, share) => sum + share.amount, 0) * 100), 10000);
  const yen = split.splitByPercent(1000, "JPY", { a: 50, b: 25, c: 25 });
  assert.deepEqual(yen.shares.map((share) => share.amount), [500, 250, 250]);
  assert.deepEqual(split.splitByPercent(100, "USD", { a: 50, b: 40 }), { ok: false, reason: "not-100" });
  assert.deepEqual(split.splitByPercent(100, "USD", {}), { ok: false, reason: "no-people" });
});

test("several payers are each credited what they paid", () => {
  const expense = {
    amount: 400,
    currency: "INR",
    date: "2026-05-27",
    payers: [{ person: "Aagam", amount: 200 }, { person: "Suhas", amount: 200 }],
    shares: split.splitEqually(400, "INR", ["Aagam", "Suhas", SELF_ID, "Venkat", "Yash"]),
  };
  const { net } = split.computeNetBalances([expense], [], same);
  assert.equal(net.get("Aagam"), 120);
  assert.equal(net.get("Suhas"), 120);
  assert.equal(net.get(SELF_ID), -80);
  assert.equal(split.payersMatchTotal(400, "INR", expense.payers), true);
  assert.equal(split.payersMatchTotal(400, "INR", [{ person: "Aagam", amount: 200 }]), false);
  assert.deepEqual(split.payersOf({ amount: 50, paidBy: "Raj" }), [{ person: "Raj", amount: 50 }]);
  assert.deepEqual(split.payersOf({ amount: 50 }), [{ person: SELF_ID, amount: 50 }]);
});

test("split mode is the stored one, else equal or custom from the shares", () => {
  const shares = [{ person: SELF_ID, amount: 60 }, { person: "Raj", amount: 40 }];
  assert.equal(split.splitModeOf({ currency: "USD", shares, split: { mode: "percent", percents: { [SELF_ID]: 60, Raj: 40 } } }), "percent");
  assert.equal(split.splitModeOf({ currency: "USD", shares }), "custom");
  assert.equal(split.splitModeOf({ currency: "USD", shares: split.splitEqually(10, "USD", ["a", "b", "c"]) }), "equal");
  assert.equal(split.splitModeOf({ currency: "USD" }), null);
});

const myMoney = loadModule("src/features/expenses/utils/myMoney.ts");

test("your spend is your share of split expenses and the whole of unsplit ones", () => {
  const dinner = { amount: 3000, date: "2026-10-01", shares: split.splitEqually(3000, "INR", [SELF_ID, "Raj", "Priya", "Sam"]) };
  assert.equal(myMoney.myShareOf(dinner), 750);
  assert.equal(myMoney.myLentOf(dinner), 2250);
  const theyPaid = { ...dinner, paidBy: "Raj" };
  assert.equal(myMoney.myShareOf(theyPaid), 750);
  assert.equal(myMoney.myLentOf(theyPaid), -750);
  const notMine = { amount: 400, date: "2026-10-01", paidBy: "Raj", shares: [{ person: "Raj", amount: 200 }, { person: "Priya", amount: 200 }] };
  assert.equal(myMoney.myShareOf(notMine), 0);
  const souvenir = { amount: 500, date: "2026-10-01" };
  assert.equal(myMoney.myShareOf(souvenir), 500);
  assert.equal(myMoney.myLentOf(souvenir), null);
});

test("spending periods: Monday-first weeks and calendar months", () => {
  const wednesday = new Date(2026, 9, 7, 15, 0);
  const week = myMoney.periodRange("week", 0, wednesday);
  assert.equal(week.start.getDay(), 1);
  assert.equal(week.start.getDate(), 5);
  assert.equal(week.end.getDate(), 12);
  const lastWeek = myMoney.periodRange("week", 1, wednesday);
  assert.equal(lastWeek.start.getDate(), 28);
  const month = myMoney.periodRange("month", 1, wednesday);
  assert.equal(month.start.getMonth(), 8);
  assert.equal(month.end.getMonth(), 9);
  assert.equal(myMoney.inRange(new Date(2026, 9, 11, 23).toISOString(), week), true);
  assert.equal(myMoney.inRange(new Date(2026, 9, 12, 0, 1).toISOString(), week), false);
});

test("shares split divides by any positive numbers and keeps the total", () => {
  const result = split.splitByUnits(1000, "INR", { [SELF_ID]: 2, Raj: 1, Priya: 1 });
  assert.deepEqual(result.shares.map((share) => share.amount), [500, 250, 250]);
  const odd = split.splitByUnits(100, "USD", { a: 1, b: 1, c: 1 });
  assert.equal(Math.round(odd.shares.reduce((sum, share) => sum + share.amount, 0) * 100), 10000);
  assert.deepEqual(split.splitByUnits(100, "USD", { a: 0 }), { ok: false, reason: "no-people" });
});

const recurring = loadModule("src/features/expenses/utils/recurring.ts");

test("recurring spends: due days after the last one, month ends clamp, catch-up is capped", () => {
  assert.deepEqual(recurring.dueDays("2026-08-01", "monthly", "2026-08-01", "2026-10-07"), ["2026-09-01", "2026-10-01"]);
  assert.deepEqual(recurring.dueDays("2026-01-31", "monthly", "2026-01-31", "2026-04-30"), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(recurring.dueDays("2026-09-30", "weekly", "2026-09-30", "2026-10-14"), ["2026-10-07", "2026-10-14"]);
  assert.deepEqual(recurring.dueDays("2024-02-29", "yearly", "2024-02-29", "2026-03-01"), ["2025-02-28", "2026-02-28"]);
  assert.equal(recurring.dueDays("2020-01-01", "weekly", null, "2026-10-07").length, 24);
  assert.equal(recurring.nextDueDay("2026-08-15", "monthly", "2026-10-07"), "2026-10-15");
});

test("monthly totals cover the last months, oldest first", () => {
  const now = new Date(2026, 9, 7);
  const totals = myMoney.monthlyTotals(
    [
      { amount: 100, date: new Date(2026, 9, 2).toISOString() },
      { amount: 50, date: new Date(2026, 8, 30).toISOString() },
      { amount: 70, date: new Date(2026, 3, 1).toISOString() },
      { amount: 999, date: new Date(2026, 2, 31).toISOString() },
    ],
    6,
    now,
  );
  assert.deepEqual(totals.map((entry) => entry.start.getMonth()), [4, 5, 6, 7, 8, 9]);
  assert.deepEqual(totals.map((entry) => entry.total), [0, 0, 0, 0, 50, 100]);
});

const exportRowsModule = loadModule("src/features/expenses/utils/exportRows.ts");

test("CSV export: quoted cells, your share, payers and split, sorted by date", () => {
  const labels = { you: "You", notInGroup: "Not in a group", headers: ["Date", "Description", "Category", "Amount", "Currency", "Group", "Paid by", "Your share", "Split"] };
  const rows = exportRowsModule.exportRows(
    [
      { date: "2026-10-02T10:00:00.000Z", merchant: "Pizza, wine", category: "food", amount: 30, currency: "EUR", groupId: "g1", paidBy: "Raj", shares: [{ person: SELF_ID, amount: 15 }, { person: "Raj", amount: 15 }], source: "manual" },
      { date: "2026-10-01T10:00:00.000Z", merchant: "Coffee", category: "food", amount: 4, currency: "EUR", groupId: null, source: "manual" },
    ],
    () => "Flat",
    labels,
  );
  assert.deepEqual(rows[0], ["2026-10-01", "Coffee", "food", "4", "EUR", "Not in a group", "You", "4", ""]);
  assert.deepEqual(rows[1], ["2026-10-02", "Pizza, wine", "food", "30", "EUR", "Flat", "Raj", "15", "You 15; Raj 15"]);
  const csv = exportRowsModule.toCsv(rows, labels.headers);
  assert.ok(csv.includes('"Pizza, wine"'));
  assert.equal(exportRowsModule.csvCell('say "hi"'), '"say ""hi"""');
});

const receipt = loadModule("src/features/expenses/utils/receiptText.ts");

test("receipt text: total, shop, date and items", () => {
  const guess = receipt.guessReceipt([
    "CAFE MOCHA",
    "Indiranagar, Bengaluru",
    "Date: 05/10/2026  21:14",
    "Paneer Tikka 320.00",
    "Butter Naan x2 120.00",
    "Mojito 1,250.00",
    "Sub Total 1,690.00",
    "CGST 2.5% 42.25",
    "SGST 2.5% 42.25",
    "Grand Total",
    "1,774.50",
    "Paid by UPI",
  ]);
  assert.equal(guess.amount, 1774.5);
  assert.equal(guess.merchant, "CAFE MOCHA");
  assert.equal(guess.date, "2026-10-05");
  assert.deepEqual(guess.items.map((item) => item.name), ["Paneer Tikka", "Butter Naan x2", "Mojito"]);
  assert.equal(receipt.parseAmount("1.234,50"), 1234.5);
  assert.equal(receipt.parseAmount("1,234"), 1234);
  assert.equal(receipt.guessReceipt(["SHOP", "12.00", "5.00"]).amount, 12);
});

test("itemised receipt: items per person, extras in proportion, exact total", () => {
  const weights = receipt.itemWeights(
    [
      { amount: 600, people: [SELF_ID] },
      { amount: 300, people: ["Rahul"] },
      { amount: 300, people: [SELF_ID, "Rahul", "Asha"] },
    ],
    120,
  );
  assert.equal(weights[SELF_ID], 770);
  assert.equal(weights.Rahul, 440);
  assert.equal(weights.Asha, 110);
  const shares = split.splitByUnits(1320, "INR", weights).shares;
  assert.equal(shares.reduce((sum, share) => sum + share.amount, 0), 1320);
});

test("as-is debts keep each pair; smart split passes debts along", () => {
  const expenses = [
    { amount: 100, currency: "INR", date: "2026-10-01", paidBy: "B", shares: [{ person: "A", amount: 100 }] },
    { amount: 100, currency: "INR", date: "2026-10-01", paidBy: "C", shares: [{ person: "B", amount: 100 }] },
  ];
  assert.deepEqual(split.pairwiseDebts(expenses, [], same, "INR"), [
    { from: "A", to: "B", amount: 100 },
    { from: "B", to: "C", amount: 100 },
  ]);
  const { net } = split.computeNetBalances(expenses, [], same);
  assert.deepEqual(split.simplifyDebts(net, "INR"), [{ from: "A", to: "C", amount: 100 }]);
  const paidBack = split.pairwiseDebts(expenses, [{ from: "A", to: "B", amount: 40, currency: "INR", date: "2026-10-02" }], same, "INR");
  assert.deepEqual(paidBack[0], { from: "A", to: "B", amount: 60 });
  const twoPayers = [{ amount: 90, currency: "INR", date: "2026-10-01", payers: [{ person: "X", amount: 60 }, { person: "Y", amount: 30 }], shares: [{ person: "Z", amount: 90 }] }];
  assert.deepEqual(split.pairwiseDebts(twoPayers, [], same, "INR"), [
    { from: "Z", to: "X", amount: 60 },
    { from: "Z", to: "Y", amount: 30 },
  ]);
});

const insights = loadModule("src/features/expenses/utils/spendInsights.ts");
const at = (y, m, d) => new Date(y, m, d, 12).toISOString();

test("trip days: per day from the start to today, bookings before the start kept apart", () => {
  const trip = { startDate: "2026-10-01", endDate: "2026-10-10" };
  const items = [
    { amount: 9000, date: at(2026, 8, 15), category: "stays" },
    { amount: 100, date: at(2026, 9, 1), category: "food" },
    { amount: 300, date: at(2026, 9, 3), category: "food" },
    { amount: 50, date: at(2026, 9, 3), category: "travel" },
  ];
  const { buckets, step, before } = insights.tripDailyTotals(items, trip, new Date(2026, 9, 4, 9));
  assert.equal(step, 1);
  assert.equal(before, 9000);
  assert.deepEqual(buckets.map((bucket) => bucket.total), [100, 0, 350, 0]);
});

test("trip days: trips over a month are grouped by week", () => {
  const trip = { startDate: "2026-01-01", endDate: "2026-02-19" };
  const { buckets, step } = insights.tripDailyTotals([{ amount: 10, date: at(2026, 0, 9), category: "food" }], trip, new Date(2026, 5, 1));
  assert.equal(step, 7);
  assert.equal(buckets.length, 8);
  assert.equal(buckets[1].total, 10);
  assert.equal(buckets[7].days, 1);
});

test("comparing periods: total change and the category that moved most", () => {
  const previous = [
    { amount: 1000, date: at(2026, 8, 3), category: "food" },
    { amount: 500, date: at(2026, 8, 5), category: "travel" },
  ];
  const current = [
    { amount: 1500, date: at(2026, 9, 3), category: "food" },
    { amount: 450, date: at(2026, 9, 5), category: "travel" },
  ];
  const result = insights.comparePeriods(current, previous);
  assert.equal(Math.round(result.change * 100), 30);
  assert.deepEqual(result.mover, { category: "food", change: 0.5 });
  assert.equal(insights.comparePeriods(current, []).change, null);
});

test("pace only for the current period once a few days are in", () => {
  const now = new Date(2026, 9, 10, 12);
  assert.equal(Math.round(insights.paceFor("month", 0, 1000, now)), 3100);
  assert.equal(insights.paceFor("month", 1, 1000, now), null);
  assert.equal(insights.paceFor("month", 0, 1000, new Date(2026, 9, 2)), null);
});

test("months by category and top places", () => {
  const items = [
    { amount: 200, date: at(2026, 9, 2), category: "food", merchant: "Cafe" },
    { amount: 100, date: at(2026, 9, 3), category: "food", merchant: " cafe " },
    { amount: 400, date: at(2026, 9, 4), category: "travel", merchant: "Uber" },
    { amount: 50, date: at(2026, 8, 4), category: "food", merchant: "" },
  ];
  const months = insights.monthlyByCategory(items, 2, new Date(2026, 9, 20));
  assert.deepEqual(months.map((month) => [month.offset, month.total]), [[1, 50], [0, 700]]);
  assert.deepEqual(months[1].categories, [{ category: "travel", amount: 400 }, { category: "food", amount: 300 }]);
  assert.deepEqual(insights.topPlaces(items, 5).map((place) => [place.name, place.amount, place.count]), [["Uber", 400, 1], ["Cafe", 300, 2]]);
  assert.equal(insights.monthsOfHistory(items, new Date(2026, 9, 20)), 2);
});
