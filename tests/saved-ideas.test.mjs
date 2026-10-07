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

const ideas = loadModule("src/features/itinerary/utils/ideas.ts");

const TOKYO = { latitude: 35.68, longitude: 139.69 };
const KYOTO = { latitude: 35.01, longitude: 135.77 };
const OSAKA = { latitude: 34.69, longitude: 135.5 };

const idea = (title, place, extra = {}) => ({ title, timing: "wishlist", place, ...extra });

test("ideas are wishlist items that aren't done", () => {
  const events = [idea("Skytree", TOKYO), { title: "Flight", timing: undefined }, idea("Done one", TOKYO, { doneAt: "2026-10-01" }), { title: "Lunch", timing: "anytime" }];
  assert.deepEqual(ideas.ideasOf(events).map((e) => e.title), ["Skytree"]);
});

test("ideas near a stop skip far and unplaced ideas, nearest first", () => {
  const list = [idea("Osaka castle", { latitude: 34.687, longitude: 135.526 }), idea("Kinkaku-ji", { latitude: 35.039, longitude: 135.729 }), idea("Skytree", TOKYO), idea("No place")];
  assert.deepEqual(ideas.ideasNear(list, KYOTO).map((e) => e.title), ["Kinkaku-ji", "Osaka castle"]);
});

test("an idea belongs to the nearest stop within range", () => {
  const stops = [TOKYO, KYOTO, OSAKA];
  assert.equal(ideas.stopIndexOf(idea("Fushimi Inari", { latitude: 34.967, longitude: 135.773 }), stops), 1);
  assert.equal(ideas.stopIndexOf(idea("Dotonbori", { latitude: 34.669, longitude: 135.501 }), stops), 2);
  assert.equal(ideas.stopIndexOf(idea("Hiroshima", { latitude: 34.39, longitude: 132.46 }), stops), null);
  assert.equal(ideas.stopIndexOf(idea("No place"), stops), null);
});

const targets = loadModule("src/features/itinerary/utils/saveTargets.ts");
const trip = (id, name, destinations, coordinates, startDate) => ({ id, name, kind: "trip", destinations, coordinates, startDate });
const planned = (id, name, destinations, coordinates) => ({ id, name, kind: "planned", destinations, coordinates });

test("a shared link goes to the trip already headed there", () => {
  const list = [trip("t1", "Tokyo", ["Tokyo, Japan"], [TOKYO], "2026-10-18"), planned("p1", "Bali someday", ["Bali, Indonesia"], [{ latitude: -8.41, longitude: 115.19 }])];
  const bali = { label: "Bali, Indonesia", kind: "place", coordinates: { latitude: -8.4, longitude: 115.2 } };
  const out = targets.saveTargets(list, "t1", bali);
  assert.deepEqual(out.choice, { kind: "existing", id: "p1" });
  assert.equal(out.ordered[0].id, "p1");
});

test("a new place suggests a new planned trip; nothing detected falls back to the active trip", () => {
  const list = [trip("t1", "Tokyo", ["Tokyo, Japan"], [TOKYO], "2026-10-18")];
  assert.deepEqual(targets.saveTargets(list, "t1", { label: "Lisbon, Portugal", kind: "city", coordinates: { latitude: 38.72, longitude: -9.14 } }).choice, { kind: "new" });
  assert.deepEqual(targets.saveTargets(list, "t1", null).choice, { kind: "existing", id: "t1" });
  assert.equal(targets.saveTargets([], null, null).choice, null);
});

test("a country matches a trip to one of its cities", () => {
  const list = [trip("t1", "Tokyo", ["Tokyo, Japan"], [TOKYO], "2026-10-18")];
  assert.deepEqual(targets.saveTargets(list, null, { label: "Japan", kind: "country" }).choice, { kind: "existing", id: "t1" });
});

const repair = loadModule("src/features/itinerary/utils/eventRepair.ts");

test("events an older sync moved out of their trip get it back", () => {
  assert.deepEqual(repair.repairEventTripId({ id: "e1", title: "Skytree", groupId: "t1" }), { id: "e1", title: "Skytree", tripId: "t1" });
  assert.deepEqual(repair.repairEventTripId({ id: "e2", groupId: null }), { id: "e2", tripId: null });
  const fine = { id: "e3", tripId: "t1" };
  assert.equal(repair.repairEventTripId(fine), fine);
});
