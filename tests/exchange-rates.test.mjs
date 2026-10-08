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

const { isCurrencyCode, isDayKey, rateKey, rateExpiry, parseFrankfurterRate, RECENT_RATE_TTL_MS } = loadModule("convex/ratesRules.ts");

test("currency codes and days are validated", () => {
  assert.ok(isCurrencyCode("EUR"));
  assert.ok(!isCurrencyCode("eur"));
  assert.ok(!isCurrencyCode("EURO"));
  assert.ok(isDayKey("2026-10-08"));
  assert.ok(!isDayKey("2026-13-45"));
  assert.ok(!isDayKey("08-10-2026"));
  assert.equal(rateKey("EUR", "INR", "2026-10-08"), "EUR|INR|2026-10-08");
});

test("only recent days expire; older ones are kept for good", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  assert.equal(rateExpiry("2026-10-08", now), now + RECENT_RATE_TTL_MS);
  assert.equal(rateExpiry("2026-10-09", now), now + RECENT_RATE_TTL_MS);
  assert.equal(rateExpiry("2026-10-07", now), now + RECENT_RATE_TTL_MS);
  assert.equal(rateExpiry("2026-10-06", now), undefined);
  assert.equal(rateExpiry("2025-01-01", now), undefined);
});

test("Frankfurter responses need a positive rate and a day", () => {
  assert.deepEqual(parseFrankfurterRate({ base: "EUR", quote: "INR", date: "2026-10-07", rate: 97.5 }), { date: "2026-10-07", rate: 97.5 });
  assert.equal(parseFrankfurterRate({ date: "2026-10-07", rate: 0 }), null);
  assert.equal(parseFrankfurterRate({ date: "2026-10-07", rate: "97.5" }), null);
  assert.equal(parseFrankfurterRate({ rate: 97.5 }), null);
  assert.equal(parseFrankfurterRate(null), null);
});
