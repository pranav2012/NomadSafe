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

const destinations = loadModule("src/features/trips/data/destinations.ts");
const foldedName = (label) => label.split(",")[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const labels = (query, selected = []) => destinations.searchOfflineDestinations(query, "en", selected).map((option) => option.label);

test("needs two characters", () => {
  assert.deepEqual(labels("l"), []);
  assert.deepEqual(labels("  "), []);
});

test("an exact city name beats longer prefixes", () => {
  assert.equal(labels("rome")[0], "Rome, Italy");
  assert.equal(labels("Lisbon")[0], "Lisbon, Portugal");
});

test("countries come before cities on a prefix", () => {
  const results = labels("portu");
  assert.equal(results[0], "Portugal");
  assert.ok(results.length <= destinations.DESTINATION_RESULT_LIMIT);
});

test("ignores accents and matches alternate names", () => {
  assert.ok(labels("sao paulo").includes("São Paulo, Brazil"));
  assert.ok(labels("reykjavik").some((label) => label.startsWith("Reykjavík")));
  assert.ok(labels("bangalore").includes("Bengaluru, India"));
});

test("matches later words and skips selected destinations", () => {
  assert.ok(labels("york").includes("New York, United States"));
  assert.ok(!labels("lisbon", ["Lisbon, Portugal"]).includes("Lisbon, Portugal"));
});

test("city-states are listed once, other capitals keep their country", () => {
  assert.deepEqual(labels("singapore").filter((label) => label.startsWith("Singapore")), ["Singapore"]);
  assert.deepEqual(labels("tunis"), ["Tunis, Tunisia", "Tunisia"]);
});

test("ignores matches in the middle of a word", () => {
  assert.ok(!labels("ven").includes("Slovenia"));
  assert.ok(!labels("nis").includes("Afghanistan"));
});

test("drops suburbs and little-known districts, keeps well-known boroughs", () => {
  for (const query of ["pudong", "bao'an", "taman petaling", "islington"]) assert.deepEqual(labels(query).filter((label) => foldedName(label) === query), []);
  assert.ok(labels("brooklyn").includes("Brooklyn, United States"));
});

test("cleans generated names", () => {
  const { CITY_ROWS } = loadModule("src/features/trips/data/cities.ts");
  const rows = CITY_ROWS.split("\n");
  assert.ok(rows.every((row) => !row.split("|")[0].endsWith("-shi")));
  const keys = rows.map((row) => `${row.split("|")[0].toLowerCase()}|${row.split("|")[2]}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("offline results carry coordinates for cities", () => {
  const [lisbon] = destinations.searchOfflineDestinations("lisbon", "en", []);
  assert.equal(lisbon.kind, "city");
  assert.ok(Math.abs(lisbon.coordinates.latitude - 38.72) < 0.05);
});

test("finds coordinates for stored labels, using the country to break ties", () => {
  const near = (coords, latitude, longitude) =>
    coords && Math.abs(coords.latitude - latitude) < 0.1 && Math.abs(coords.longitude - longitude) < 0.1;
  assert.ok(near(destinations.findOfflineCoordinates("Lisbon, Portugal"), 38.72, -9.13));
  assert.ok(near(destinations.findOfflineCoordinates("New York, United States"), 40.71, -74.01));
  assert.ok(near(destinations.findOfflineCoordinates("Bangalore"), 12.97, 77.59));
  assert.ok(near(destinations.findOfflineCoordinates("London, Canada"), 42.98, -81.23));
  assert.equal(destinations.findOfflineCoordinates("Portugal"), null);
  assert.equal(destinations.findOfflineCoordinates("Atlantis, Nowhere"), null);
});

test("a search over the whole index is fast", () => {
  destinations.searchOfflineDestinations("warm", "en", []);
  const started = performance.now();
  for (const query of ["sa", "san", "sant", "santa", "santi", "zz", "qu", "new y", "ber"]) {
    destinations.searchOfflineDestinations(query, "en", []);
  }
  assert.ok(performance.now() - started < 100);
});
