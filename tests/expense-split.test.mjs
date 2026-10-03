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
