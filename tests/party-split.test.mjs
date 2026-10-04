import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

function loadModule(entryPoint) {
  const output = buildSync({ entryPoints: [entryPoint], bundle: true, format: "cjs", platform: "node", target: "node20", write: false })
    .outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const { parseParty, planAutoSplit } = loadModule("src/features/expenses/utils/party.ts");
const SELF = "__self__";

test("reads head-counts from hotel, ticket and form-style emails", () => {
  assert.equal(parseParty("Email property You booked for 2 adults Check-in Sunday 18 October 2026").pax, 2);
  assert.equal(parseParty("Your reservation 1 night You booked for 2 adults and 1 child").pax, 3);
  assert.equal(parseParty("Participation Date: 2026-10-23 Units: 2 x Adult, 1 x Child").pax, 3);
  assert.equal(parseParty("Number of guests: 4 Check-in 2pm").pax, 4);
  assert.equal(parseParty("Your receipt. Amount paid ¥9,000").pax, null);
});

test("reads guest and passenger names, deduplicated, in any name order", () => {
  const hotel = parseParty("Japanese-Style Room - 202 for guest Alex Morgan price: ¥12,200 You booked for 2 adults");
  assert.deepEqual(hotel, { pax: 2, names: ["Alex Morgan"] });
  const flight = parseParty(
    "MR. MORGAN ALEX : Vegetarian Meal MS. RIVERA SAM : 28F Seat selection MR. MORGAN ALEX : 28E",
  );
  assert.deepEqual(flight, { pax: 2, names: ["MORGAN ALEX", "RIVERA SAM"] });
  assert.equal(parseParty("RIVERA/SAM MS e-ticket").names[0], "RIVERA SAM");
});

const base = { amount: 17367, currency: "JPY", selfName: "Alex Morgan", shared: false };

test("two pax on a two-person trip splits equally in yen, leftover yen to you", () => {
  const plan = planAutoSplit({ pax: 2, names: [] }, { ...base, companions: ["Sam Rivera"] });
  assert.deepEqual(plan, { kind: "split", shares: [{ person: SELF, amount: 8684 }, { person: "Sam Rivera", amount: 8683 }] });
});

test("named passengers pick the right companions out of a bigger group", () => {
  const plan = planAutoSplit(
    { pax: 3, names: ["MORGAN ALEX", "RIVERA SAM", "LEE JO"] },
    { ...base, amount: 30000, companions: ["Sam Rivera", "Jo Lee", "Priya"] },
  );
  assert.deepEqual(plan, {
    kind: "split",
    shares: [{ person: SELF, amount: 10000 }, { person: "Sam Rivera", amount: 10000 }, { person: "Jo Lee", amount: 10000 }],
  });
});

test("a head-count that matches the whole group splits across everyone", () => {
  const plan = planAutoSplit({ pax: 4, names: [] }, { ...base, amount: 10, currency: "INR", companions: ["Sam", "Jo", "Priya"] });
  assert.equal(plan.kind, "split");
  assert.deepEqual(plan.shares.map((s) => s.amount), [2.5, 2.5, 2.5, 2.5]);
});

test("fewer people than the group with no names asks the user instead of guessing", () => {
  const plan = planAutoSplit({ pax: 2, names: [] }, { ...base, companions: ["Sam", "Jo", "Priya"] });
  assert.deepEqual(plan, { kind: "hint", hint: { pax: 2, people: [SELF] } });
});

test("shared trips get a proposed split to confirm, never a silent one", () => {
  const plan = planAutoSplit({ pax: 2, names: [] }, { ...base, shared: true, companions: ["Sam Rivera"] });
  assert.equal(plan.kind, "hint");
  assert.deepEqual(plan.hint.people, [SELF, "Sam Rivera"]);
  assert.equal(plan.hint.shares.length, 2);
});

test("solo bookings and trips without companions stay personal", () => {
  assert.equal(planAutoSplit({ pax: 1, names: [] }, { ...base, companions: ["Sam"] }), null);
  assert.equal(planAutoSplit({ pax: 2, names: [] }, { ...base, companions: [] }), null);
  assert.equal(planAutoSplit({ pax: null, names: [] }, { ...base, companions: ["Sam"] }), null);
});
