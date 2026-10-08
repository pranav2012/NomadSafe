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

const forex = loadModule("src/features/expenses/utils/forex.ts");
const SELF_ID = "__self__";

const pocket = (overrides = {}) => ({
  id: "p1",
  groupId: "trip",
  kind: "cash",
  currency: "JPY",
  homeCurrency: "INR",
  loads: [{ id: "l1", date: "2026-10-02T10:00:00.000Z", amount: 100000, paid: 58000, marketRate: 0.56 }],
  spendIds: [],
  createdAt: "2026-10-02T10:00:00.000Z",
  ...overrides,
});

const spend = (id, amount, extra = {}) => ({ id, groupId: "trip", amount, currency: "JPY", ...extra });

test("the fee is what was paid over the market value that day", () => {
  const fee = forex.loadFee({ amount: 100000, paid: 58000, marketRate: 0.56, homeCurrency: "INR" });
  assert.equal(fee.marketValue, 56000);
  assert.equal(fee.fee, 2000);
  assert.ok(Math.abs(fee.pct - 3.5714) < 0.001);
});

test("paying at or below market logs no fee", () => {
  assert.equal(forex.loadFee({ amount: 100000, paid: 56000, marketRate: 0.56, homeCurrency: "INR" }).fee, 0);
  assert.equal(forex.loadFee({ amount: 100000, paid: 50000, marketRate: 0.56, homeCurrency: "INR" }).fee, 0);
  assert.equal(forex.loadFee({ amount: 100000, paid: 50000, marketRate: 0, homeCurrency: "INR" }).fee, 0);
});

test("spends paid from the pocket deduct only your paid part, in its trip and currency", () => {
  const p = pocket({ spendIds: ["a", "b", "c", "d", "e"] });
  const expenses = [
    spend("a", 1200),
    // You paid the whole split dinner in cash.
    spend("b", 9000, { paidBy: SELF_ID, shares: [{ person: SELF_ID, amount: 3000 }, { person: "Raj", amount: 6000 }] }),
    // Several payers: only your part leaves your pocket.
    spend("c", 5000, { payers: [{ person: SELF_ID, amount: 2000 }, { person: "Raj", amount: 3000 }] }),
    // Moved to another trip, and re-priced in another currency: both drop out.
    spend("d", 700, { groupId: "other" }),
    spend("e", 10, { currency: "USD" }),
    spend("f", 999),
  ];
  const balance = forex.pocketBalance(p, expenses);
  assert.equal(balance.loaded, 100000);
  assert.equal(balance.spent, 1200 + 9000 + 2000);
  assert.equal(balance.left, 100000 - 12200);
  assert.equal(balance.rate, 0.56);
  assert.equal(balance.leftValue, 49168);
});

test("top-ups at different rates use the weighted average market rate", () => {
  const p = pocket({
    loads: [
      { id: "l1", date: "2026-10-02", amount: 100000, paid: 58000, marketRate: 0.56 },
      { id: "l2", date: "2026-10-05", amount: 50000, paid: 30000, marketRate: 0.59 },
    ],
  });
  assert.ok(Math.abs(forex.pocketRate(p) - 0.57) < 1e-9);
});

test("trip total equals bank outflow minus what came back", () => {
  const p = pocket({ spendIds: ["a", "b"] });
  const expenses = [spend("a", 60000), spend("b", 31800)];
  const balance = forex.pocketBalance(p, expenses);
  const fee = forex.loadFee({ amount: 100000, paid: 58000, marketRate: 0.56, homeCurrency: "INR" }).fee;
  const received = 4300;
  const result = forex.conversionResult({ leftover: balance.left, rate: balance.rate, received, homeCurrency: "INR" });
  assert.equal(balance.left, 8200);
  assert.equal(result, 292);
  const tripTotal = fee + balance.spentValue + result;
  assert.equal(Math.round(tripTotal * 100) / 100, 58000 - received);
});

test("converting back for more than the pocket rate is a gain (negative)", () => {
  assert.equal(forex.conversionResult({ leftover: 8200, rate: 0.56, received: 4700, homeCurrency: "INR" }), -108);
});

test("a kept or converted pocket has nothing left; a written-off one keeps its leftover spend", () => {
  const p = pocket({ spendIds: ["a"] });
  const expenses = [spend("a", 90000)];
  assert.equal(forex.pocketBalance({ ...p, closed: { kind: "kept", date: "x", leftover: 10000 } }, expenses).left, 0);
  assert.equal(forex.pocketBalance({ ...p, closed: { kind: "converted", date: "x", leftover: 10000, received: 5000 } }, expenses).left, 0);
  const writtenOff = { ...p, spendIds: ["a", "w"], closed: { kind: "writtenOff", date: "x", leftover: 10000, expenseId: "w" } };
  assert.equal(forex.pocketBalance(writtenOff, [...expenses, spend("w", 10000)]).left, 0);
});

test("counting cash: a positive gap is untracked spending", () => {
  assert.equal(forex.countedGap(8200, 6000, "JPY"), 2200);
  assert.equal(forex.countedGap(8200, 9000, "JPY"), -800);
  assert.equal(forex.countedGap(10.5, 10.25, "EUR"), 0.25);
});

test("pocket spends convert at the pocket rate only into its home currency", () => {
  const hints = forex.pocketRateHints([pocket({ spendIds: ["a"] })]);
  assert.equal(forex.hintedRate(hints.get("a"), "JPY", "INR"), 0.56);
  assert.equal(forex.hintedRate(hints.get("a"), "JPY", "USD"), undefined);
  assert.equal(forex.hintedRate(hints.get("a"), "USD", "INR"), undefined);
  assert.equal(forex.hintedRate(hints.get("b"), "JPY", "INR"), undefined);
});

test("kept leftovers wait as spare forex until carried to a trip", () => {
  const kept = pocket({ id: "k", closed: { kind: "kept", date: "2026-10-10", leftover: 8200 } });
  const carried = pocket({ id: "c", closed: { kind: "kept", date: "2026-10-11", leftover: 500, carriedTo: "next" } });
  const converted = pocket({ id: "v", closed: { kind: "converted", date: "2026-10-12", leftover: 100, received: 50 } });
  assert.deepEqual(forex.sparePockets([kept, carried, converted]).map((p) => p.id), ["k"]);
});

test("a new spend defaults to the only open cash pocket in its currency", () => {
  const cash = pocket();
  const card = pocket({ id: "card", kind: "card" });
  const closed = pocket({ id: "old", closed: { kind: "kept", date: "x", leftover: 1 } });
  assert.equal(forex.defaultPocketFor([card, cash, closed], "trip", "JPY")?.id, "p1");
  assert.equal(forex.defaultPocketFor([card], "trip", "JPY"), null);
  assert.equal(forex.defaultPocketFor([cash, pocket({ id: "p2" })], "trip", "JPY"), null);
  assert.equal(forex.defaultPocketFor([cash], "trip", "EUR"), null);
  assert.deepEqual(forex.payablePockets([card, cash, closed], "trip").map((p) => p.id), ["p1", "card"]);
});

test("spoken spends say cash in several languages", () => {
  assert.equal(forex.saysCash("paid 1200 yen cash for ramen"), true);
  assert.equal(forex.saysCash("500 rupaye नकद chai"), true);
  assert.equal(forex.saysCash("dinner 3000 with Raj"), false);
  assert.equal(forex.saysCash("cashew nuts 300"), false);
});
