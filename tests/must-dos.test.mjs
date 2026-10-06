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

const { mustDosNear } = loadModule("src/features/itinerary/utils/mustDos.ts");
const { tripPrep } = loadModule("src/features/home/utils/tripPrep.ts");

const BALI = { latitude: -8.41, longitude: 115.19 };

test("must-dos come from the nearest bundled destination, in the app's language when we have it", () => {
  const english = mustDosNear(BALI, "en");
  assert.equal(english.place, "Bali");
  assert.ok(english.items.length >= 3);
  assert.equal(english.items[0].key, "Tanah Lot");
  const japanese = mustDosNear(BALI, "ja");
  assert.equal(japanese.items[0].key, "Tanah Lot");
  assert.notEqual(japanese.items[0].name, "Tanah Lot");
  assert.equal(mustDosNear({ latitude: 0, longitude: -140 }, "en"), null);
});

test("must-dos skip what's already planned or dismissed, in any language", () => {
  const all = mustDosNear(BALI, "en").items;
  const japaneseName = mustDosNear(BALI, "ja").items[0].name;
  assert.ok(!mustDosNear(BALI, "en", ["tanah lot"]).items.some((item) => item.key === "Tanah Lot"));
  assert.ok(!mustDosNear(BALI, "ja", [japaneseName]).items.some((item) => item.key === "Tanah Lot"));
  assert.equal(mustDosNear(BALI, "en", [all[1].key]).items.length, all.length - 1);
});

const at = (d, h) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00`;
const trip = { startDate: "2026-10-18", endDate: "2026-10-25" };

test("trip prep finds the first booking and the nights still without a stay", () => {
  const events = [
    { type: "activity", title: "Ghibli", startAt: at(19, 10) },
    { type: "stay", title: "Gracery", startAt: at(18, 15), endAt: at(21, 11) },
    { type: "stay", title: "Kyoto inn", startAt: at(23, 15), endAt: at(24, 11) },
    { type: "transit", title: "JL754", startAt: at(18, 2) },
    { type: "activity", title: "Wish", startAt: at(18, 0), timing: "wishlist" },
  ];
  const prep = tripPrep(events, trip);
  assert.equal(prep.first.title, "JL754");
  assert.equal(prep.nights, 7);
  assert.equal(prep.bookedNights, 4);
  assert.deepEqual(
    prep.gaps.map(([from, to]) => [from.getDate(), to.getDate()]),
    [[21, 22], [24, 24]],
  );
});

test("trip prep lists no gaps until some stay is booked", () => {
  const prep = tripPrep([{ type: "transit", title: "JL754", startAt: at(18, 2) }], trip);
  assert.equal(prep.bookedNights, 0);
  assert.deepEqual(prep.gaps, []);
});
