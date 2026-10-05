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
    alias: { "@": "./src" },
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const transit = loadModule("src/features/itinerary/utils/transit.ts");
const recap = loadModule("src/features/recap/utils/recapFacts.ts");
const shapes = loadModule("src/features/recap/utils/countryShapes.ts");
const map = loadModule("src/features/recap/utils/recapMap.ts");

const PLACES = {
  tokyo: { latitude: 35.68, longitude: 139.69 },
  kyoto: { latitude: 35.01, longitude: 135.77 },
  osaka: { latitude: 34.69, longitude: 135.5 },
  bengaluru: { latitude: 12.97, longitude: 77.59 },
};
const locate = (name) => PLACES[name.trim().toLowerCase()] ?? null;

test("infers transit modes, trains before flights", () => {
  assert.equal(transit.inferTransitMode("JL754"), "flight");
  assert.equal(transit.inferTransitMode("6E 2134"), "flight");
  assert.equal(transit.inferTransitMode("IndiGo", "Flight to Goa"), "flight");
  assert.equal(transit.inferTransitMode("IRCTC e-ticket", "PNR 4512 boarding at SBC"), "train");
  assert.equal(transit.inferTransitMode("Shinkansen Nozomi"), "train");
  assert.equal(transit.inferTransitMode("FlixBus", "Berlin → Prague"), "bus");
  assert.equal(transit.inferTransitMode("Ferry to Koh Tao"), "ferry");
  assert.equal(transit.inferTransitMode("Hertz pickup"), "car");
  assert.equal(transit.inferTransitMode("Transfer"), undefined);
});

test("stored mode wins and only transit events have one", () => {
  assert.equal(transit.transitModeOf({ type: "transit", title: "JL754", transitMode: "train" }), "train");
  assert.equal(transit.transitModeOf({ type: "stay", title: "Flight Hotel" }), undefined);
});

test("parses route ends", () => {
  assert.deepEqual(transit.parseRouteEnds("Hoi An → Hue"), ["Hoi An", "Hue"]);
  assert.deepEqual(transit.parseRouteEnds("BLR - NRT"), ["BLR", "NRT"]);
  assert.deepEqual(transit.parseRouteEnds("Bengaluru ( Kempegowda Intl ) → Tokyo"), ["Bengaluru", "Tokyo"]);
  assert.deepEqual(transit.parseRouteEnds("Kyoto to Osaka · car 4"), ["Kyoto", "Osaka"]);
  assert.equal(transit.parseRouteEnds("Check-out"), null);
  assert.equal(transit.parseRouteEnds("Tokyo → Tokyo"), null);
  assert.equal(transit.parseRouteEnds(undefined), null);
});

test("legs take the mode of the transit event that covers them", () => {
  const facts = recap.computeRecapFacts({
    trip: { startDate: "2026-10-18", endDate: "2026-10-27", destinations: ["Tokyo", "Kyoto", "Osaka"] },
    coordinates: [PLACES.tokyo, PLACES.kyoto, PLACES.osaka],
    events: [
      { type: "transit", title: "JL754", detail: "Bengaluru → Tokyo", startAt: "2026-10-18T02:55:00" },
      { type: "transit", title: "Shinkansen", detail: "Tokyo → Kyoto", startAt: "2026-10-21T09:00:00" },
      { type: "stay", title: "Hotel", startAt: "2026-10-18T15:00:00" },
      { type: "activity", title: "Fushimi Inari", startAt: "2026-10-22T08:00:00" },
    ],
    locate,
    countryOf: () => "JP",
  });
  assert.equal(facts.days, 10);
  assert.equal(facts.stops.length, 3);
  assert.deepEqual(facts.legs.map((leg) => leg.mode), ["train", null]);
  assert.equal(facts.tripsByMode.flight, 1);
  assert.equal(facts.tripsByMode.train, 1);
  assert.ok(facts.kmByMode.flight > 6000, "flight from home counts");
  assert.ok(Math.abs(facts.kmByMode.train - facts.legs[0].km) < 1);
  assert.ok(Math.abs(facts.kmByMode.other - facts.legs[1].km) < 1, "uncovered leg counts as other");
  assert.ok(Math.abs(facts.totalKm - (facts.kmByMode.flight + facts.kmByMode.train + facts.kmByMode.other)) < 1e-6);
  assert.equal(facts.stays, 1);
  assert.equal(facts.activities, 1);
});

test("unplaced stops and routes are skipped, not guessed", () => {
  const facts = recap.computeRecapFacts({
    trip: { startDate: "2026-10-18", endDate: "2026-10-18", destinations: ["Nowhere", "Tokyo"] },
    coordinates: [null, PLACES.tokyo],
    events: [{ type: "transit", title: "Bus", detail: "Atlantis → Tokyo", startAt: "2026-10-18T10:00:00" }],
    locate,
    countryOf: () => "JP",
  });
  assert.equal(facts.days, 1);
  assert.equal(facts.stops.length, 1);
  assert.equal(facts.legs.length, 0);
  assert.equal(facts.totalKm, 0);
  assert.equal(facts.tripsByMode.bus, 1);
});

test("stops carry their country, listed once in trip order", () => {
  const facts = recap.computeRecapFacts({
    trip: { startDate: "2026-10-18", endDate: "2026-10-20", destinations: ["Tokyo", "Kyoto"] },
    coordinates: [PLACES.tokyo, PLACES.kyoto],
    events: [],
    locate,
    countryOf: () => "JP",
  });
  assert.deepEqual(facts.countries, ["JP"]);
  assert.equal(facts.stops[1].country, "JP");
});

test("finds the country under a point", () => {
  assert.equal(shapes.countryAt(35.68, 139.69), "JP");
  assert.equal(shapes.countryAt(48.86, 2.35), "FR");
  assert.equal(shapes.countryAt(12.97, 77.59), "IN");
  assert.equal(shapes.countryAt(-35.28, 149.13), "AU");
  assert.equal(shapes.countryAt(0, -30), null, "mid-Atlantic");
});

test("countries in a box include the trip's neighbours", () => {
  const codes = shapes.countriesInBox({ west: 125, south: 30, east: 146, north: 46 });
  assert.ok(codes.includes("JP"));
  assert.ok(codes.includes("KR"));
  assert.ok(!codes.includes("FR"));
});

test("the frame fits every stop inside the padded box", () => {
  const stops = [PLACES.tokyo, PLACES.kyoto, PLACES.osaka, { latitude: 43.06, longitude: 141.35 }];
  const frame = map.frameRoute(stops, 800, 600, 40);
  for (const stop of stops) {
    const p = frame.project(stop.longitude, stop.latitude);
    assert.ok(p.x >= 39 && p.x <= 761 && p.y >= 39 && p.y <= 561, JSON.stringify(p));
  }
  assert.ok(frame.box.west < 135.5 && frame.box.east > 141.35);
});

test("a single stop frames its country and stays on screen", () => {
  const frame = map.frameRoute([PLACES.tokyo], 800, 600, 40, { west: 129, south: 31, east: 146, north: 45.5 });
  const p = frame.project(139.69, 35.68);
  assert.ok(p.x > 0 && p.x < 800 && p.y > 0 && p.y < 600);
  assert.ok(frame.box.east - frame.box.west > 10);
});

test("labels never overlap each other or other dots, and skip when there is no room", () => {
  const requests = [
    { at: { x: 100, y: 100 }, width: 120, height: 30, priority: 0 },
    { at: { x: 110, y: 104 }, width: 120, height: 30, priority: 2 },
    { at: { x: 300, y: 300 }, width: 120, height: 30, priority: 1 },
    { at: { x: 5, y: 5 }, width: 2000, height: 30, priority: 3 },
  ];
  const placed = map.placeLabels(requests, { width: 600, height: 400 }, 8);
  assert.ok(placed[0] && placed[2]);
  assert.equal(placed[3], null);
  const rects = placed.filter(Boolean);
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      assert.ok(!(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));
    }
});

test("flights bow out more than ground legs", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  assert.ok(Math.abs(map.legControl(a, b, "flight").y) > Math.abs(map.legControl(a, b, "train").y));
  assert.deepEqual(map.curvePoint(a, map.legControl(a, b, null), b, 1), b);
});

test("the camera fits points into a region and caps zoom", () => {
  const region = { x: 0, y: 100, width: 400, height: 300 };
  const cam = map.cameraFor([{ x: 10, y: 10 }, { x: 110, y: 60 }], region, { padding: 20, minSize: 40, maxZoom: 3 });
  const project = (p) => ({ x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y });
  for (const p of [project({ x: 10, y: 10 }), project({ x: 110, y: 60 })]) {
    assert.ok(p.x >= 0 && p.x <= 400 && p.y >= 100 && p.y <= 400, JSON.stringify(p));
  }
  const single = map.cameraFor([{ x: 50, y: 50 }], region, { padding: 20, minSize: 40, maxZoom: 3 });
  assert.equal(single.zoom, 3);
  assert.equal(50 * single.zoom + single.x, 200);
});

const passport = loadModule("src/features/passport/utils/passport.ts");
const regions = loadModule("tests/fixtures/regions-entry.ts");
const CONTINENT = { IN: "Asia", JP: "Asia", FR: "Europe", TH: "Asia" };
const trip = (id, status, stops, days = 5, startDate = "2026-01-10") => ({ id, name: id, startDate, endDate: startDate, days, status, stops });

test("international stops become one stamp per country per trip; home stops become state seals", () => {
  const model = passport.buildPassport({
    home: "IN",
    continentOf: (c) => CONTINENT[c] ?? null,
    past: [],
    trips: [
      trip("t1", "complete", [
        { name: "Tokyo", country: "JP", region: "JP-13" },
        { name: "Kyoto", country: "JP", region: "JP-26" },
        { name: "Paris", country: "FR", region: null },
      ], 12),
      trip("t2", "complete", [{ name: "Goa", country: "IN", region: "IN-GA" }], 4, "2026-03-01"),
      trip("t3", "complete", [{ name: "Panaji", country: "IN", region: "IN-GA" }, { name: "Kochi", country: "IN", region: "IN-KL" }], 6, "2025-12-01"),
      trip("t4", "upcoming", [{ name: "Bangkok", country: "TH", region: null }], 7, "2027-01-01"),
    ],
  });
  assert.deepEqual(model.stamps.map((s) => [s.country, s.place, s.pending]), [["JP", "Tokyo", false], ["FR", "Paris", false], ["TH", "Bangkok", true]]);
  assert.deepEqual(model.seals.map((s) => [s.region, s.visits]), [["IN-GA", 2], ["IN-KL", 1]]);
  assert.equal(model.seals[0].first, "2025-12-01");
  assert.equal(model.countries, 3, "Japan, France and home; the upcoming trip doesn't count yet");
  assert.equal(model.continents, 2);
  assert.equal(model.daysAbroad, 12);
  assert.equal(model.latest.country, "FR");
});

test("past travel adds plain stamps and seals that aren't marked as app trips", () => {
  const model = passport.buildPassport({
    home: "IN",
    continentOf: (c) => CONTINENT[c] ?? null,
    trips: [],
    past: [
      { id: "p1", country: "FR", region: null, place: "Paris, France", year: 2019, month: 5 },
      { id: "p2", country: "IN", region: "IN-KL", place: "Kochi", year: 2018, month: null },
    ],
  });
  assert.equal(model.stamps.length, 1);
  assert.equal(model.stamps[0].viaApp, false);
  assert.equal(model.stamps[0].date, "2019-05");
  assert.deepEqual(model.seals.map((s) => [s.region, s.viaApp, s.first]), [["IN-KL", false, "2018"]]);
  assert.equal(model.countries, 2);
});

test("without a home country every stop is international", () => {
  const model = passport.buildPassport({ home: null, continentOf: () => null, past: [], trips: [trip("t", "complete", [{ name: "Goa", country: "IN", region: "IN-GA" }])] });
  assert.equal(model.stamps.length, 1);
  assert.equal(model.seals.length, 0);
});

test("stamp styling is stable per country", () => {
  assert.equal(passport.pick("JP", 4), passport.pick("JP", 4));
  assert.ok(passport.pick("JP", 4) >= 0 && passport.pick("JP", 4) < 4);
});

test("finds the state for a city, falling back near coastlines", () => {
  assert.equal(regions.regionAt("IN", 12.97, 77.59).key, "IN-KA");
  assert.equal(regions.regionAt("IN", 15.49, 73.83).key, "IN-GA");
  assert.equal(regions.regionAt("US", 40.71, -74.0).key, "US-NY");
  assert.equal(regions.regionAt("FR", 43.7, 7.27).name, "Provence-Alpes-Côte-d'Azur");
  assert.equal(regions.regionAt("GB", 55.95, -3.19).name, "Scotland");
  assert.equal(regions.countryRegions("IN").length, 36);
  assert.ok(regions.mainlandBox("FR").west > -10, "overseas regions are left out of the home map");
});

test("India view draws India's official borders and leaves the default view alone", () => {
  const gilgit = [35.92, 74.31];
  const aksaiChin = [35.2, 79.2];
  assert.equal(shapes.countryAt(...gilgit), "PK");
  assert.notEqual(shapes.countryAt(...aksaiChin), "IN");

  // The passport bundle shares the store instance, so switch the view through it.
  regions.__setView("IN");
  try {
    assert.equal(regions.__countryAt(...gilgit), "IN");
    assert.equal(regions.__countryAt(...aksaiChin), "IN");
    assert.equal(regions.regionAt("IN", ...gilgit).key, "IN-LA");
    assert.equal(regions.regionAt("IN", 34.0, 73.7).key, "IN-JK", "Azad Kashmir is part of Jammu and Kashmir");
    assert.equal(regions.countryRegions("IN").length, 36);
    assert.ok(!regions.countryRegions("PK").some((r) => r.key === "PK-GB"), "Pakistan no longer holds Gilgit-Baltistan");
  } finally {
    regions.__setView("default");
  }
  assert.equal(regions.regionAt("IN", 34.16, 77.58).key, "IN-LA", "Leh is in Ladakh either way");
});

const airports = loadModule("src/features/itinerary/utils/airports.ts");

test("flight legs stored as airport codes are placed and counted", () => {
  assert.deepEqual(airports.airportCoordinates("BLR"), { latitude: 13.2, longitude: 77.71 });
  assert.ok(airports.airportCoordinates("NRT"));
  assert.equal(airports.airportCoordinates("Goa"), null, "only three capital letters are codes");
  assert.equal(airports.airportCoordinates("ZZZ"), null);
  const facts = recap.computeRecapFacts({
    trip: { startDate: "2026-10-18", endDate: "2026-10-20", destinations: ["Tokyo"] },
    coordinates: [PLACES.tokyo],
    events: [{ type: "transit", title: "IndiGo", detail: "BLR → NRT", startAt: "2026-10-18T02:00:00" }],
    locate: (place) => airports.airportCoordinates(place) ?? locate(place),
    countryOf: () => "JP",
  });
  assert.equal(facts.tripsByMode.flight, 1);
  assert.ok(facts.kmByMode.flight > 6500 && facts.kmByMode.flight < 7000, String(facts.kmByMode.flight));
});

test("a route between two airport codes is a flight", () => {
  assert.equal(transit.inferTransitMode("IndiGo", "BLR → NRT"), "flight");
  assert.equal(transit.inferTransitMode("Bus", "Goa - Pune"), "bus");
});
