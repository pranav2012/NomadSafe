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

const transactionParser = loadModule("src/features/expenses/services/transactionParser.ts");
const emailProviders = loadModule("src/features/expenses/services/emailProviders.ts");

test("imports Booking.com confirmation total as a committed stay", () => {
  const body = [
    "Booking.com confirmation. Your booking is confirmed at The LOL Elephant Hostel. Your booking in Bangkok is confirmed.",
    "The LOL Elephant Hostel is expecting you.",
    "Total price THB 1,276.10. Total paid THB 0.",
  ].join(" ");
  const transaction = transactionParser.parseTransaction(body, "2026-06-10T07:42:22.000Z");
  const provider = emailProviders.matchEmailProvider(body, "noreply@booking.com");

  assert.equal(transaction?.amount, 1276.1);
  assert.equal(transaction?.currency, "THB");
  assert.equal(provider.category, "stays");
  assert.equal(provider.merchant, "The LOL Elephant Hostel");
});

test("imports SmartBuy flight with the out-of-pocket cash amount", () => {
  const body = [
    "Your Flight Booking with SmartBuy is Successful.",
    "Departure Flight Bangalore to Phuket. Total ₹ 11,292. Paid by Cash ₹ 7,251.",
  ].join(" ");
  const transaction = transactionParser.parseTransaction(body, "2026-06-05T20:32:23.000Z");
  const provider = emailProviders.matchEmailProvider(body, "donotreply@smartbuyoffers.co");

  assert.equal(transaction?.amount, 7251);
  assert.equal(transaction?.currency, "INR");
  assert.equal(provider.category, "travel");
  assert.equal(provider.merchant, "SmartBuy");
});

const amountInput = loadModule("src/features/expenses/utils/amountInput.ts");

function parse(body, options) {
  return transactionParser.parseTransaction(body, "2026-06-10T07:42:22.000Z", options);
}

function localParts(iso) {
  const date = new Date(iso);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

test("parses dot-thousands and comma-decimal amounts", () => {
  assert.equal(parse("EUR 1.234,56 spent at Carrefour")?.amount, 1234.56);
  assert.equal(parse("Rp 150.000 spent at Warung Made")?.amount, 150000);
  assert.equal(parse("VND 1.200.000 spent at Pho 24")?.amount, 1200000);
  assert.equal(parse("Paid EUR 12,50 at Bakery")?.amount, 12.5);
});

test("keeps Indian and comma-thousands amounts working", () => {
  assert.equal(parse("INR 1,23,456.50 debited from a/c XX12 at Croma")?.amount, 123456.5);
  assert.equal(parse("Rs.1,23,456 debited at Croma")?.amount, 123456);
  assert.equal(parse("$1,299.99 charged at Apple Store")?.amount, 1299.99);
  assert.equal(parse("Rs.450.00 spent at Cafe.")?.amount, 450);
});

test("rejects OTP messages", () => {
  assert.equal(parse("Your OTP for txn of Rs 500 at Amazon is 123456. Do not share."), null);
  assert.equal(parse("Use verification code 8812 to complete payment of INR 999"), null);
  assert.equal(parse("One-time password for purchase of $20 is 4455"), null);
});

test("rejects balance and statement notices", () => {
  assert.equal(parse("Available balance in your a/c XX12 is Rs 25,000 as on 12-05-26"), null);
  assert.equal(parse("Your card statement is generated. Total amount due Rs 12,400. Minimum amount due Rs 620. Payment due date 05-06-26"), null);
  assert.equal(parse("Minimum amt due INR 500 on your credit card"), null);
});

test("still imports debits that mention the remaining balance", () => {
  const tx = parse("Rs 500 debited from a/c XX1234 at SWIGGY. Avl bal Rs 5,000");
  assert.equal(tx?.amount, 500);
  assert.equal(tx?.kind, "debit");
});

test("resolves credit vs debit with word boundaries", () => {
  assert.equal(parse("Refund of Rs 250 for your purchase at Amazon has been processed")?.kind, "credit");
  assert.equal(parse("Rs 250 reversed to your a/c for failed payment of Rs 250")?.kind, "credit");
  assert.equal(parse("INR 2,000 spent on HDFC Bank Debit Card XX12 at STARBUCKS")?.kind, "debit");
  assert.equal(parse("Your a/c is credited with Rs 1,000 via NEFT")?.kind, "credit");
  assert.equal(parse("Rs 300 debited from A/c XX12 and credited to swiggy@upi")?.kind, "debit");
  assert.equal(parse("Prepaid wallet loaded with Rs 300"), null);
  assert.equal(parse("Rs 400 credit card bill"), null);
});

test("does not treat letters inside words as currency tokens", () => {
  assert.equal(parse("Paid 45 USD for 3 hours parking")?.currency, "USD");
  assert.equal(parse("Paid 2 hours ago. Total 90 THB at Arcade Corp")?.currency, "THB");
  assert.equal(parse("Arcade Corp charged 20 hours"), null);
});

test("maps dollar-prefixed symbols and bare $ with the trip currency", () => {
  assert.equal(parse("A$ 42.00 spent at Woolworths")?.currency, "AUD");
  assert.equal(parse("HK$ 88 spent at Tsui Wah")?.currency, "HKD");
  assert.equal(parse("C$15 spent at Tim Hortons")?.currency, "CAD");
  assert.equal(parse("NZ$ 30 spent at Countdown")?.currency, "NZD");
  assert.equal(parse("AU$ 12 spent at Coles")?.currency, "AUD");
  assert.equal(parse("US$ 12 spent at Coles", { currencyHint: "AUD" })?.currency, "USD");
  assert.equal(parse("$12 spent at Coles")?.currency, "USD");
  assert.equal(parse("$12 spent at Coles", { currencyHint: "AUD" })?.currency, "AUD");
  assert.equal(parse("$12 spent at Coles", { currencyHint: "INR" })?.currency, "USD");
});

test("resolves yen/yuan by trip currency", () => {
  assert.equal(parse("¥1,200 spent at Lawson")?.currency, "JPY");
  assert.equal(parse("¥1,200 spent at Lawson", { currencyHint: "CNY" })?.currency, "CNY");
  assert.equal(parse("¥1,200 spent at Lawson")?.amount, 1200);
});

test("reads the transaction date from pasted alert bodies", () => {
  const reference = new Date(2026, 8, 27, 10);
  const at = (body) => transactionParser.parseTransaction(body, undefined, { referenceDate: reference })?.occurredAt;

  assert.deepEqual(localParts(at("Rs 500 debited on 12-05-26 at Swiggy")), [2026, 5, 12]);
  assert.deepEqual(localParts(at("Rs 500 debited on 03/08/2025 at Swiggy")), [2025, 8, 3]);
  assert.deepEqual(localParts(at("Rs 500 spent at Swiggy on 14 Sep")), [2026, 9, 14]);
  assert.deepEqual(localParts(at("Rs 500 spent at Swiggy on 14 Dec")), [2025, 12, 14]);
  assert.deepEqual(localParts(at("Rs 500 spent at Swiggy on 5-Jan-2026")), [2026, 1, 5]);
  // 31/02 must not roll over into March; falls back to the reference date.
  assert.deepEqual(localParts(at("Rs 500 debited on 31/02/2026 at Swiggy")), [2026, 9, 27]);
  assert.deepEqual(localParts(at("Rs 500 debited at Swiggy")), [2026, 9, 27]);
  // An explicit occurredAt (e.g. email date) still wins.
  assert.equal(parse("Rs 500 debited on 12-05-26 at Swiggy")?.occurredAt, "2026-06-10T07:42:22.000Z");
});

test("normalizes amount input with either decimal separator", () => {
  assert.equal(amountInput.parseAmountInput("12,50", "."), 12.5);
  assert.equal(amountInput.parseAmountInput("12,50", ","), 12.5);
  assert.equal(amountInput.parseAmountInput("1.250,75", ","), 1250.75);
  assert.equal(amountInput.parseAmountInput("1,250.75", "."), 1250.75);
  assert.equal(amountInput.parseAmountInput("1,250", "."), 1250);
  assert.equal(amountInput.parseAmountInput("1,250", ","), 1.25);
  assert.equal(amountInput.parseAmountInput("45", "."), 45);
  assert.ok(Number.isNaN(amountInput.parseAmountInput("", ".")));
});

const dateKey = loadModule("src/features/expenses/utils/dateKey.ts");

test("buckets dates by local calendar day", () => {
  const lateEvening = new Date(2026, 4, 12, 23, 30);
  assert.equal(dateKey.toLocalDayKey(lateEvening), "2026-05-12");
  assert.equal(dateKey.toLocalDayKey(lateEvening.toISOString()), "2026-05-12");
  assert.equal(dateKey.toLocalDayKey("2026-05-12"), "2026-05-12");
  const parsed = dateKey.fromLocalDayKey("2026-05-12");
  assert.deepEqual([parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours()], [2026, 4, 12, 0]);
});

const heuristic = loadModule("src/features/expenses/services/categoryHeuristic.ts");

function categorizeAlert(body) {
  const tx = parse(body);
  return heuristic.categorizeHeuristic({ merchant: tx?.merchant ?? "", rawText: body });
}

test("categorizes a pasted El Corte Inglés alert as shopping, not travel", () => {
  const body = "EUR 1.234,56 spent on your card ending 4182 at EL CORTE INGLES";
  assert.equal(parse(body)?.merchant, "El Corte Ingles");
  assert.deepEqual(categorizeAlert(body), { category: "shopping", matched: true });
  assert.equal(heuristic.categorizeHeuristic({ merchant: "El Corte Inglés" }).category, "shopping");
});

test("matches keywords on word boundaries only", () => {
  assert.equal(heuristic.categorizeHeuristic({ merchant: "Card Services Ltd" }).matched, false);
  assert.equal(heuristic.categorizeHeuristic({ merchant: "Barcelona Tickets" }).matched, false);
  assert.equal(heuristic.categorizeHeuristic({ merchant: "Business Centre" }).matched, false);
  assert.equal(heuristic.categorizeHeuristic({ merchant: "Coca Cola Kiosk" }).matched, false);
  assert.equal(heuristic.categorizeHeuristic({ merchant: "Dinner Club" }).matched, false);
  assert.equal(heuristic.categorizeHeuristic({ merchant: "Joe's Bar" }).category, "food");
  assert.equal(heuristic.categorizeHeuristic({ merchant: "Macy's" }).category, "shopping");
});

test("categorizes common chains across regions", () => {
  const cases = {
    shopping: [
      "Carrefour Express", "LIDL", "Aldi Süd", "Tesco Metro", "Boots", "Zara", "H&M",
      "IKEA", "Decathlon", "Uniqlo", "7-Eleven", "Walgreens", "CVS Pharmacy", "Walmart",
      "Target", "Big Bazaar", "DMart", "Reliance Fresh", "Farmacia Central", "Monoprix",
    ],
    food: ["Starbucks", "Pizzeria Da Michele", "Boulangerie Paul", "Swiggy", "Uber Eats"],
    stays: ["Hotel Avenida", "Airbnb", "Holiday Inn Express", "Generator Hostel"],
    travel: ["Uber", "Ryanair", "Renfe", "Shell", "Indian Oil", "Hertz", "Airport Parking"],
    other: ["Vodafone", "Airalo eSIM", "ATM cash withdrawal"],
  };
  for (const [category, merchants] of Object.entries(cases)) {
    for (const merchant of merchants) {
      assert.equal(heuristic.categorizeHeuristic({ merchant }).category, category, merchant);
    }
  }
});

test("prefers the merchant over alert boilerplate", () => {
  const result = heuristic.categorizeHeuristic({
    merchant: "Carrefour",
    rawText: "Spent at Carrefour. Book your next flight with us!",
  });
  assert.equal(result.category, "shopping");
  assert.deepEqual(
    heuristic.categorizeHeuristic({ merchant: "Arcade Corp", rawText: "Rp 150.000 spent on card XX12" }),
    { category: "other", matched: false },
  );
});

import { readFileSync } from "node:fs";

const formats = loadModule("src/features/expenses/utils/importFormats.ts");
const fixture = (name) => formats.decodeBytes(new Uint8Array(readFileSync(`tests/fixtures/import/${name}`)));

test("Splitwise export: rows rebuilt from nets, payments, personal rows and the total check", () => {
  const parsed = formats.parseImport(fixture("splitwise-trip.csv"));
  assert.equal(parsed.source, "splitwise");
  assert.equal(parsed.people.length, 7);
  assert.deepEqual(parsed.former, ["Hari Goyal"]);
  const kinds = parsed.rows.reduce((acc, row) => ({ ...acc, [row.kind]: (acc[row.kind] ?? 0) + 1 }), {});
  assert.deepEqual(kinds, { expense: 89, payment: 12, personal: 12 });
  for (const row of parsed.rows.filter((r) => r.kind === "expense")) {
    const paid = row.payers.reduce((sum, p) => sum + p.amount, 0);
    const shared = row.shares.reduce((sum, s) => sum + s.amount, 0);
    assert.ok(Math.abs(paid - row.amount) < 0.02, row.description);
    assert.ok(Math.abs(shared - row.amount) < 0.02, row.description);
  }
  const multi = parsed.rows.find((r) => r.description === "Lunch at bamboo plantation");
  assert.equal(multi.payers.length, 3);
  assert.equal(multi.estimated, true);
  assert.equal(formats.matchesTotals(parsed.rows, parsed.totals), true);
  const bus = parsed.rows.find((r) => r.description === "Bus from blr to coorg");
  assert.equal(bus.category, "travel");
  assert.deepEqual(bus.payers, [{ person: "Vik Arora", amount: 7500 }]);
});

test("Settle Up export: UTF-16, several payers exact, transfers, rounding absorbed", () => {
  const parsed = formats.parseImport(fixture("settleup-group.csv"));
  assert.equal(parsed.source, "settleup");
  assert.equal(parsed.rows.filter((r) => r.kind === "payment").length, 4);
  const auto = parsed.rows.find((r) => r.description === "Auto to Hosteller");
  assert.deepEqual(auto.payers, [{ person: "Arun", amount: 200 }, { person: "Sunil", amount: 200 }]);
  for (const row of parsed.rows.filter((r) => r.kind === "expense")) {
    assert.ok(Math.abs(row.shares.reduce((sum, s) => sum + s.amount, 0) - row.amount) < 0.001, row.description);
  }
  const balances = formats.importBalances(parsed.rows);
  for (const byCurrency of Object.values(balances)) assert.ok(Math.abs(byCurrency.INR) < 0.05);
  const two = formats.parseImport(fixture("settleup-two.csv"));
  assert.equal(two.people.length, 2);
  assert.equal(two.rows.find((r) => r.description.startsWith("Booking.com")).category, "stays");
});

test("CSV parsing keeps quoted commas and quotes", () => {
  assert.deepEqual(formats.parseCsv('a,"b, c","d ""e"""\r\n\r\n1,2,3'), [["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
  assert.equal(formats.parseImport("hello,world\n1,2"), null);
});

const build = loadModule("src/features/expenses/utils/importBuild.ts");
const splitUtils = loadModule("src/features/expenses/utils/split.ts");

test("import build: history keeps balances; balances mode carries over the same debts", () => {
  const parsed = formats.parseImport(fixture("splitwise-small.csv"));
  const people = { "Alex Doe": splitUtils.SELF_ID, "Priya Lal": "Priya", "Sam Bose": "Sam" };
  const options = { people, mine: new Set(), categorize: () => "other", carriedOver: "Carried over", today: "2026-10-07" };
  const history = build.buildImport(parsed, { ...options, mode: "history" });
  assert.equal(history.settlements.length, 2);
  const balances = build.buildImport(parsed, { ...options, mode: "balances" });
  const net = (result) =>
    splitUtils.computeNetBalances(
      result.expenses.filter((e) => e.shares).map((e) => ({ ...e })),
      result.settlements,
      () => 1,
    ).net;
  const a = net(history);
  const b = net(balances);
  for (const person of [splitUtils.SELF_ID, "Priya", "Sam"]) assert.ok(Math.abs((a.get(person) ?? 0) - (b.get(person) ?? 0)) < 0.05, person);
  const personal = history.expenses.find((e) => e.merchant === "Puncture");
  assert.equal(personal, undefined);
  const mine = build.buildImport(parsed, { ...options, mode: "history", mine: new Set(parsed.rows.filter((r) => r.kind === "personal").map((r) => r.key)) });
  assert.equal(mine.expenses.find((e) => e.merchant === "Puncture").shares, undefined);
});

test("base64 file bytes decode back to the same text, UTF-16 included", () => {
  const raw = readFileSync("tests/fixtures/import/settleup-two.csv");
  const viaBase64 = formats.decodeBytes(formats.base64ToBytes(raw.toString("base64")));
  assert.equal(viaBase64, formats.decodeBytes(new Uint8Array(raw)));
  assert.equal(formats.decodeBytes(formats.base64ToBytes(Buffer.from("héllo ✓").toString("base64"))), "héllo ✓");
});
