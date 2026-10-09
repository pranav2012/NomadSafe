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

const framing = loadModule("src/features/trips/utils/mapFraming.ts");
const tripName = loadModule("src/features/trips/utils/tripName.ts");
const money = loadModule("src/features/expenses/utils/money.ts");
const dates = loadModule("src/features/trips/utils/dates.ts");
const budget = loadModule("src/features/trips/utils/budgetEstimate.ts");

const LISBON = { latitude: 38.72, longitude: -9.14 };
const PORTO = { latitude: 41.15, longitude: -8.61 };
const SINTRA = { latitude: 38.8, longitude: -9.38 };
const SAN_FRANCISCO = { latitude: 37.77, longitude: -122.42 };

test("frames destinations only when the user is far away", () => {
  assert.deepEqual(framing.tripFramePoints([LISBON, PORTO], SAN_FRANCISCO), [LISBON, PORTO]);
  assert.deepEqual(framing.tripFramePoints([LISBON], SAN_FRANCISCO), [LISBON]);
});

test("includes the user when within 150 km of a destination", () => {
  assert.deepEqual(framing.tripFramePoints([LISBON, PORTO], SINTRA), [SINTRA, LISBON, PORTO]);
  assert.deepEqual(framing.tripFramePoints([], SINTRA), [SINTRA]);
  assert.deepEqual(framing.tripFramePoints([], null), []);
});

test("uses a city-level region for a single destination", () => {
  const region = framing.regionForPoints([LISBON]);
  assert.equal(region.latitude, LISBON.latitude);
  assert.ok(region.latitudeDelta >= 0.2 && region.latitudeDelta <= 0.5);
  assert.ok(framing.isCompactFrame([LISBON]));
  assert.ok(!framing.isCompactFrame([LISBON, PORTO]));
  assert.ok(Math.abs(framing.distanceKm(LISBON, PORTO) - 274) < 10);
});

const t = (key, params) =>
  key === "trip.defaultName" ? `${params.destination} trip` : `${params.first} & more`;

test("derives a default trip name from the first destination city", () => {
  assert.equal(tripName.defaultTripName(["Lisbon, Portugal"], t), "Lisbon trip");
  assert.equal(tripName.defaultTripName(["Lisbon, Portugal", "Porto, Portugal"], t), "Lisbon & more");
  assert.equal(tripName.defaultTripName(["Japan"], t), "Japan trip");
  assert.equal(tripName.defaultTripName([], t), "");
});

const formatCurrency = (amount, currency = "USD", options) =>
  options
    ? new Intl.NumberFormat("en-US", { style: "currency", currency, ...options }).format(amount)
    : amount >= 100_000
      ? "compact"
      : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);

test("shows cents only when the amount has them", () => {
  assert.equal(money.formatMoney(formatCurrency, 1500.5, "USD"), "$1,500.50");
  assert.equal(money.formatMoney(formatCurrency, 1500, "USD"), "$1,500");
  assert.equal(money.formatMoney(formatCurrency, 93.35, "USD"), "$93.35");
  assert.equal(money.formatMoney(formatCurrency, 1500.004, "USD"), "$1,500");
  assert.equal(money.formatMoney(formatCurrency, 250000, "USD"), "compact");
  assert.equal(money.formatMoney(formatCurrency, 1200, "JPY"), "¥1,200");
});

test("days left counts today, so the last day shows 1", () => {
  const trip = { startDate: "2026-10-10", endDate: "2026-10-14" };
  assert.equal(dates.daysLeftInTrip(trip, new Date(2026, 9, 1, 9)), 5, "upcoming: the whole trip");
  assert.equal(dates.daysLeftInTrip(trip, new Date(2026, 9, 10, 9)), 5, "first day");
  assert.equal(dates.daysLeftInTrip(trip, new Date(2026, 9, 14, 23)), 1, "last day");
  assert.equal(dates.daysLeftInTrip(trip, new Date(2026, 9, 15, 0)), 0, "over");
});

test("budget totals multiply per-person USD by days and travellers, then convert", () => {
  // 20 days in Japan, one traveller, $130/day, 1 USD = 84 INR.
  assert.deepEqual(budget.tripBudgetTotals(130, 20, 1, 84), { total: 220000, daily: 11000 });
  assert.deepEqual(budget.tripBudgetTotals(100, 7, 2, 1), { total: 1400, daily: 200 });
  assert.deepEqual(budget.tripBudgetTotals(61.7, 3, 1, 1), { total: 185, daily: 62 });
});

test("budget totals are hidden without a usable rate or inputs", () => {
  assert.equal(budget.tripBudgetTotals(100, 7, 1, null), null);
  assert.equal(budget.tripBudgetTotals(100, 7, 1, 0), null);
  assert.equal(budget.tripBudgetTotals(100, 0, 1, 1), null);
  assert.equal(budget.tripBudgetTotals(100, 7, 0, 1), null);
  assert.equal(budget.tripBudgetTotals(Number.NaN, 7, 1, 1), null);
});

test("estimates round to about two significant figures", () => {
  assert.equal(budget.roundEstimate(13240), 13000);
  assert.equal(budget.roundEstimate(1234), 1250);
  assert.equal(budget.roundEstimate(87), 87);
  assert.equal(budget.roundEstimate(7.4), 7);
  assert.equal(budget.roundEstimate(0), 0);
});
