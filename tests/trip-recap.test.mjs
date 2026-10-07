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

const timeline = loadModule("src/features/recap/utils/cardTimeline.ts");

test("the video's card animation starts empty and ends on the static card", () => {
  const start = timeline.cardTimeline(0, 4);
  assert.equal(start.ticket, 0);
  assert.equal(start.route, 0);
  assert.equal(start.stamp, 0);
  const end = timeline.cardTimeline(timeline.CARD_BUILD_SECONDS, 4);
  for (const key of ["ticket", "text", "land", "stamp", "stats", "footer"]) assert.equal(end[key], 1, key);
  assert.equal(end.route, Infinity);
  assert.equal(end.flapTime, Infinity);
  let previous = -1;
  for (let t = 0; t <= timeline.CARD_BUILD_SECONDS; t += 0.25) {
    const route = Math.min(4, timeline.cardTimeline(t, 4).route);
    assert.ok(route >= previous, `route never goes backwards (t=${t})`);
    previous = route;
  }
});

test("flaps settle left to right and flip deterministically", () => {
  assert.ok(!timeline.flapSettled(0.3, 0));
  assert.ok(timeline.flapSettled(0.5, 0));
  assert.ok(!timeline.flapSettled(0.5, 3));
  assert.equal(timeline.flapLetter(0.2, 1), timeline.flapLetter(0.2, 1));
  assert.match(timeline.flapLetter(0.2, 1), /^[A-Z]$/);
  assert.equal(timeline.stampScale(1), 1);
  assert.ok(timeline.stampScale(0) > 2);
});

const moments = loadModule("src/features/recap/utils/moments.ts");

test("walking covers the trip's local days", () => {
  const { start, end } = moments.walkingWindow({ startDate: "2026-10-18", endDate: "2026-10-20" });
  assert.equal(start.getDate(), 18);
  assert.equal(end.getDate(), 21);
  assert.equal(start.getHours(), 0);
  assert.ok(moments.walkingStale(undefined, "2026-10-20"));
  assert.ok(moments.walkingStale("2026-10-21T10:00:00Z", "2026-10-20"), "read before health apps finished syncing");
  assert.ok(!moments.walkingStale("2026-10-30T10:00:00Z", "2026-10-20"));
});

test("reads photo dates and places from iOS and Android EXIF", () => {
  assert.equal(moments.parseExifDate({ DateTimeOriginal: "2026:10:18 14:22:05" }), "2026-10-18T14:22:05");
  assert.equal(moments.parseExifDate({ "{Exif}": { DateTimeOriginal: "2026:10:19 08:00:00" } }), "2026-10-19T08:00:00");
  assert.equal(moments.parseExifDate({}), null);
  const ios = moments.parseExifGps({ "{GPS}": { Latitude: 35.68, LatitudeRef: "N", Longitude: 139.69, LongitudeRef: "E" } });
  assert.deepEqual(ios, { latitude: 35.68, longitude: 139.69 });
  const android = moments.parseExifGps({ GPSLatitude: "33/1,52/1,1800/100", GPSLatitudeRef: "S", GPSLongitude: "151/1,12/1,0/1", GPSLongitudeRef: "E" });
  assert.ok(Math.abs(android.latitude + 33.8717) < 0.001 && Math.abs(android.longitude - 151.2) < 0.001);
  assert.equal(moments.parseExifGps({ GPSLatitude: 0, GPSLongitude: 0 }), null);
});

test("photos go to the nearest stop within range", () => {
  const stops = [PLACES.tokyo, PLACES.kyoto, PLACES.osaka];
  assert.equal(moments.nearestStop({ latitude: 35.0, longitude: 135.76 }, stops), 1);
  assert.equal(moments.nearestStop({ latitude: 43.06, longitude: 141.35 }, stops), null, "Sapporo is too far from every stop");
  assert.equal(moments.nearestStop(null, stops), null);
});

const replay = loadModule("src/features/recap/utils/replayFacts.ts");
const curation = loadModule("src/features/recap/utils/photoCuration.ts");

test("legs remember the day their transit event left", () => {
  const facts = recap.computeRecapFacts({
    trip: { startDate: "2026-10-18", endDate: "2026-10-27", destinations: ["Tokyo", "Kyoto", "Osaka"] },
    coordinates: [PLACES.tokyo, PLACES.kyoto, PLACES.osaka],
    events: [{ type: "transit", title: "Shinkansen", detail: "Tokyo → Kyoto", startAt: "2026-10-21T09:00:00" }],
    locate,
    countryOf: () => "JP",
  });
  assert.deepEqual(facts.legs.map((leg) => leg.date), ["2026-10-21", null]);
});

test("stop schedule takes leg days, then stays naming the city, then splits evenly", () => {
  const schedule = replay.stopSchedule({
    startDate: "2026-10-18",
    endDate: "2026-10-27",
    stops: [{ name: "Tokyo" }, { name: "Kyoto, Japan" }, { name: "Osaka" }],
    legDates: ["2026-10-21", null],
    stays: [{ title: "Hotel Osaka Bay", startAt: "2026-10-25T15:00:00" }],
  });
  assert.deepEqual(schedule.map((s) => [s.from, s.to, s.nights]), [
    ["2026-10-18", "2026-10-21", 3],
    ["2026-10-21", "2026-10-25", 4],
    ["2026-10-25", "2026-10-27", 2],
  ]);
  const even = replay.stopSchedule({ startDate: "2026-10-01", endDate: "2026-10-09", stops: [{ name: "A" }, { name: "B" }, { name: "C" }], legDates: [null, null], stays: [] });
  assert.deepEqual(even.map((s) => s.from), ["2026-10-01", "2026-10-04", "2026-10-07"]);
  const backwards = replay.stopSchedule({ startDate: "2026-10-01", endDate: "2026-10-09", stops: [{ name: "A" }, { name: "B" }, { name: "C" }], legDates: ["2026-10-06", "2026-10-03"], stays: [] });
  assert.deepEqual(backwards.map((s) => s.from), ["2026-10-01", "2026-10-06", "2026-10-06"], "arrivals never go backwards");
  assert.equal(backwards[1].nights, 0);
});

test("days map to the stop the trip was at, with a day of slack", () => {
  const schedule = replay.stopSchedule({ startDate: "2026-10-18", endDate: "2026-10-27", stops: [{ name: "Tokyo" }, { name: "Kyoto" }], legDates: ["2026-10-21"], stays: [] });
  assert.equal(replay.stopOnDay(schedule, "2026-10-17"), 0);
  assert.equal(replay.stopOnDay(schedule, "2026-10-20"), 0);
  assert.equal(replay.stopOnDay(schedule, "2026-10-21"), 1, "arrival day belongs to the new stop");
  assert.equal(replay.stopOnDay(schedule, "2026-10-28"), 1);
  assert.equal(replay.stopOnDay(schedule, "2026-10-30"), null);
  const best = replay.biggestWalkingDays(
    [
      { date: "2026-10-18", steps: 9000 },
      { date: "2026-10-19", steps: 21000 },
      { date: "2026-10-22", steps: 1500 },
      { date: "2026-11-02", steps: 40000 },
    ],
    schedule,
  );
  assert.deepEqual(best, [{ date: "2026-10-19", steps: 21000 }, null]);
});

test("highlights per stop: done first, activities before food, pins before dates", () => {
  const schedule = replay.stopSchedule({ startDate: "2026-10-18", endDate: "2026-10-27", stops: [{ name: "Tokyo" }, { name: "Kyoto" }], legDates: ["2026-10-21"], stays: [] });
  const highlights = replay.stopHighlights(
    [
      { type: "food", title: "Ichiran", startAt: "2026-10-19T19:00:00" },
      { type: "activity", title: "teamLab", startAt: "2026-10-20T10:00:00" },
      { type: "activity", title: "Fushimi Inari", startAt: "2026-10-18T08:00:00", place: { latitude: 34.97, longitude: 135.77 }, doneAt: "2026-10-22T09:00:00" },
      { type: "activity", title: "Not done idea", startAt: "2026-10-18T00:00:00", timing: "wishlist" },
      { type: "transit", title: "Shinkansen", startAt: "2026-10-21T09:00:00" },
      { type: "activity", title: "teamLab", startAt: "2026-10-20T15:00:00" },
    ],
    [PLACES.tokyo, PLACES.kyoto],
    schedule,
  );
  assert.deepEqual(highlights, [["teamLab", "Ichiran"], ["Fushimi Inari"]]);
});

test("first-time countries get their number in the order first reached", () => {
  const stamps = [
    { country: "FR", date: "2019-05", tripId: null, pending: false },
    { country: "JP", date: "2026-10-18", tripId: "t2", pending: false },
    { country: "KR", date: "2026-10-25", tripId: "t2", pending: false },
    { country: "FR", date: "2026-03-01", tripId: "t1", pending: false },
    { country: "TH", date: "2027-01-01", tripId: "t3", pending: true },
  ];
  const milestones = replay.countryMilestones(stamps, "t2", "IN", ["JP", "KR"]);
  assert.deepEqual(milestones.firstTime, ["JP", "KR"]);
  assert.deepEqual(milestones.numbers, { JP: 3, KR: 4 });
  assert.equal(milestones.total, 4, "home, France, Japan, Korea; the upcoming trip doesn't count");
  assert.deepEqual(replay.countryMilestones(stamps, "t1", "IN", ["FR"]).firstTime, [], "France was visited before");
});

test("companions are shared members other than you, else the names typed in", () => {
  assert.deepEqual(replay.tripCompanions({ companions: ["Asha", "Ravi ", "Asha"] }), ["Asha", "Ravi"]);
  const shared = {
    myMemberId: "m1",
    members: [
      { memberId: "m1", name: "Me", status: "active" },
      { memberId: "m2", name: "Asha", status: "active" },
      { memberId: "m3", name: "Left", status: "left" },
    ],
  };
  assert.deepEqual(replay.tripCompanions({ companions: ["Old"], shared }), ["Asha"]);
});

test("distances get a familiar yardstick", () => {
  assert.equal(replay.compareDistance(4), null);
  assert.deepEqual(replay.compareDistance(130), { kind: "marathons", count: 3 });
  assert.deepEqual(replay.compareDistance(1050), { kind: "londonParis", count: 3 });
  assert.deepEqual(replay.compareDistance(4200), { kind: "earthFraction", fraction: "tenth" });
  assert.deepEqual(replay.compareDistance(9500), { kind: "earthFraction", fraction: "quarter" });
  assert.deepEqual(replay.compareDistance(11500), { kind: "londonNewYork", count: 2 });
  assert.deepEqual(replay.compareDistance(80150), { kind: "earthTimes", times: 2 });
});

const TRIP = { startDate: "2026-10-18", endDate: "2026-10-27" };
const photo = (id, extra = {}) => ({ id, takenAt: "2026-10-19T10:00:00", latitude: null, longitude: null, width: 4000, height: 3000, labels: [], ...extra });

test("curation drops photos from outside the trip and ones that aren't moments", () => {
  assert.equal(curation.rejectReason(photo("a", { takenAt: "2026-10-10T10:00:00" }), TRIP), "outsideTrip");
  assert.equal(curation.rejectReason(photo("b", { takenAt: "2026-10-17T22:00:00" }), TRIP), null, "a day of slack");
  assert.equal(curation.rejectReason(photo("c", { labels: [{ label: "Food", confidence: 0.9 }] }), TRIP), "food");
  assert.equal(curation.rejectReason(photo("d", { labels: [{ label: "food", confidence: 0.7 }, { label: "People", confidence: 0.9 }] }), TRIP), null, "dinner with friends stays");
  assert.equal(curation.rejectReason(photo("e", { labels: [{ label: "Asphalt", confidence: 0.8 }] }), TRIP), "ground");
  assert.equal(curation.rejectReason(photo("f", { labels: [{ label: "road", confidence: 0.7 }, { label: "mountain", confidence: 0.85 }] }), TRIP), null);
  assert.equal(curation.rejectReason(photo("g", { labels: [{ label: "Receipt", confidence: 0.6 }, { label: "sky", confidence: 0.9 }] }), TRIP), "utility");
  assert.equal(curation.rejectReason(photo("h", { utility: true }), TRIP), "utility");
  assert.equal(curation.rejectReason(photo("i", { takenAt: null }), TRIP), null, "undated photos stay, ranked lower");
  assert.ok(curation.photoScore(photo("j")) > curation.photoScore(photo("k", { takenAt: null })));
  assert.ok(curation.photoScore(photo("l", { labels: [{ label: "landmark", confidence: 0.9 }], sharpness: 0.9 })) > curation.photoScore(photo("m", { sharpness: 0.1 })));
});

test("curation keeps the best of a burst, three per stop, spread over days", () => {
  const schedule = replay.stopSchedule({ startDate: TRIP.startDate, endDate: TRIP.endDate, stops: [{ name: "Tokyo" }, { name: "Kyoto" }], legDates: ["2026-10-21"], stays: [] });
  const context = { ...TRIP, stops: [PLACES.tokyo, PLACES.kyoto], schedule };
  const candidates = [
    photo("burst1", { takenAt: "2026-10-19T10:00:00", sharpness: 0.2 }),
    photo("burst2", { takenAt: "2026-10-19T10:00:20", sharpness: 0.9 }),
    photo("burst3", { takenAt: "2026-10-19T10:00:45", sharpness: 0.5 }),
    photo("day19b", { takenAt: "2026-10-19T18:00:00", sharpness: 0.8 }),
    photo("day19c", { takenAt: "2026-10-19T20:00:00", sharpness: 0.85 }),
    photo("day20", { takenAt: "2026-10-20T12:00:00", sharpness: 0.3 }),
    photo("kyotoGps", { takenAt: "2026-10-19T12:00:00", latitude: 35.0, longitude: 135.76 }),
    photo("food", { takenAt: "2026-10-22T13:00:00", labels: [{ label: "Dish", confidence: 0.95 }] }),
    photo("old", { takenAt: "2025-01-01T10:00:00" }),
  ];
  const result = curation.curatePhotos(candidates, context);
  const tokyo = result.chosen.filter((c) => c.stop === 0).map((c) => c.id);
  assert.equal(tokyo.length, 3);
  assert.ok(tokyo.includes("burst2") && !tokyo.includes("burst1") && !tokyo.includes("burst3"), "best of the burst");
  assert.ok(tokyo.includes("day20"), "the second day gets a photo before day 19 gets a third");
  assert.deepEqual(result.chosen.filter((c) => c.stop === 1).map((c) => c.id), ["kyotoGps"], "GPS wins over the date");
  assert.deepEqual(result.rejected.map((r) => [r.id, r.reason]).sort(), [["food", "food"], ["old", "outsideTrip"]]);
  assert.ok(result.alternates.some((a) => a.id === "burst1"));
});

test("curation respects kept photos and the overall cap", () => {
  const stops = Array.from({ length: 10 }, (_, i) => ({ latitude: 10 + i * 5, longitude: 10 }));
  const schedule = replay.stopSchedule({ startDate: "2026-10-01", endDate: "2026-10-20", stops: stops.map((_, i) => ({ name: `S${i}` })), legDates: stops.slice(1).map(() => null), stays: [] });
  const candidates = [];
  stops.forEach((stop, i) => {
    for (let k = 0; k < 4; k += 1) candidates.push(photo(`s${i}p${k}`, { takenAt: `2026-10-${String(1 + i * 2).padStart(2, "0")}T${10 + k}:00:00`, latitude: stop.latitude, longitude: stop.longitude, sharpness: k / 4 }));
  });
  candidates.push(photo("kept", { takenAt: null, kept: { stop: 0 }, sharpness: 0 }));
  const result = curation.curatePhotos(candidates, { startDate: "2026-10-01", endDate: "2026-10-20", stops, schedule });
  assert.equal(result.chosen.length, curation.MAX_CHOSEN_PHOTOS);
  assert.ok(result.chosen.some((c) => c.id === "kept"));
  for (let i = 0; i < stops.length; i += 1) assert.ok(result.chosen.filter((c) => c.stop === i).length <= curation.PHOTOS_PER_STOP);
});

test("the shared video runs 15–20 s and ends on the static card", () => {
  for (const counts of [[0], [3], [2, 2, 2], [1, 0, 3, 3, 3, 3, 3, 3], Array.from({ length: 14 }, () => 3)]) {
    const plan = timeline.planVideo(counts);
    assert.ok(plan.duration >= 14.99 && plan.duration <= 20.5, `${counts.length} stops: ${plan.duration}`);
    plan.stops.forEach((stop, i) => assert.ok(stop.photos.length <= Math.min(2, counts[i])));
    const end = timeline.videoFrameAt(plan, plan.duration);
    assert.deepEqual(end.card, timeline.CARD_FINAL);
    assert.equal(end.cardAlpha, 1);
    assert.equal(end.photos.length, 0);
    let previous = -1;
    for (let t = 0; t < plan.numbers[0]; t += 1 / timeline.VIDEO_FPS) {
      const frame = timeline.videoFrameAt(plan, t);
      assert.ok(frame.route >= previous - 1e-9, "the route only grows");
      previous = frame.route;
      for (const p of frame.photos) assert.ok(p.alpha > 0 && p.alpha <= 1 && p.zoom >= 1);
    }
  }
  const plan = timeline.planVideo([2, 2]);
  const [start, end] = plan.stops[0].photos[0];
  const mid = timeline.videoFrameAt(plan, (start + end) / 2);
  assert.deepEqual(mid.photos.map((p) => [p.stop, p.slot]), [[0, 0]]);
  assert.equal(mid.map, 0, "a photo covers the map");
  assert.equal(timeline.videoFrameAt(plan, 0.5).focus, -1);
});

const chapters = loadModule("src/features/recap/utils/replayChapters.ts");

test("replay chapters appear only when there is something to show, and stops grow with photos", () => {
  const minimal = chapters.replayChapters({ photosPerStop: [0], highlightsPerStop: [0], totalKm: 5, countries: false, companions: false, stamped: false });
  assert.deepEqual(minimal.map((c) => c.kind), ["intro", "stop", "numbers", "finale"]);
  const full = chapters.replayChapters({ photosPerStop: [3, 0], highlightsPerStop: [0, 2], totalKm: 900, countries: true, companions: true, stamped: true });
  assert.deepEqual(full.map((c) => c.kind), ["intro", "stop", "stop", "distance", "countries", "companions", "numbers", "stamp", "finale"]);
  assert.ok(chapters.chapterMs(full[1]) > chapters.chapterMs(full[2]), "three photos play longer than a map-only stop");
  assert.ok(chapters.chapterMs(full[2]) > chapters.chapterMs(minimal[1]), "highlights get time to read");
  assert.equal(chapters.chapterMs({ kind: "finale" }), 0);
  const phases = chapters.stopPhases(3);
  assert.ok(Math.abs(phases.arrival + 3 * phases.photo - 1) < 1e-9);
  assert.deepEqual(chapters.stopPhases(0), { arrival: 1, photo: 0 });
});

test("kept photos are grouped by stop: stored stop, then GPS, then date", () => {
  const schedule = replay.stopSchedule({ startDate: "2026-10-18", endDate: "2026-10-27", stops: [{ name: "Tokyo" }, { name: "Kyoto" }], legDates: ["2026-10-21"], stays: [] });
  const groups = curation.photosByStop(
    [
      { id: "a", stop: 1, score: 0.5, takenAt: "2026-10-19T10:00:00", latitude: null, longitude: null },
      { id: "b", takenAt: "2026-10-19T10:00:00", latitude: 35.0, longitude: 135.76 },
      { id: "c", takenAt: "2026-10-19T11:00:00", latitude: null, longitude: null },
      { id: "d", stop: 1, score: 1.2, takenAt: "2026-10-23T10:00:00", latitude: null, longitude: null },
      { id: "e", takenAt: null, latitude: null, longitude: null },
    ],
    [PLACES.tokyo, PLACES.kyoto],
    schedule,
  );
  assert.deepEqual(groups.map((list) => list.map((p) => p.id)), [["c"], ["d", "a", "b"]]);
});

test("long legs with no booking count as likely flights; short ones stay road and other", () => {
  const sapporo = { latitude: 43.06, longitude: 141.35 };
  const facts = recap.computeRecapFacts({
    trip: { startDate: "2026-10-18", endDate: "2026-10-27", destinations: ["Tokyo", "Sapporo", "Kyoto", "Osaka"] },
    coordinates: [PLACES.tokyo, sapporo, PLACES.kyoto, PLACES.osaka],
    events: [],
    locate,
    countryOf: () => "JP",
  });
  assert.ok(facts.kmByMode.likelyFlight > 1500, "Tokyo → Sapporo and Sapporo → Kyoto");
  assert.ok(facts.kmByMode.other < 60, "Kyoto → Osaka");
  assert.deepEqual(facts.legs.map((leg) => leg.mode), [null, null, null], "legs stay unbooked on the map");
  assert.ok(Math.abs(facts.totalKm - facts.legs.reduce((sum, leg) => sum + leg.km, 0)) < 1e-6);
});

test("pictures covered in text are left out, and phone-shaped undated ones with a little text too", () => {
  assert.equal(curation.rejectReason(photo("r", { textCoverage: 0.2 }), TRIP), "utility", "a receipt");
  assert.equal(curation.rejectReason(photo("s", { takenAt: null, width: 1080, height: 2340, textCoverage: 0.03 }), TRIP), "utility", "a screenshot");
  assert.equal(curation.rejectReason(photo("t", { textCoverage: 0.03 }), TRIP), null, "a street with a shop sign");
  assert.equal(curation.rejectReason(photo("u", { textCoverage: null }), TRIP), null);
});
