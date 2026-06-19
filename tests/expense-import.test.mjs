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
