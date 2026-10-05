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

const tiles = loadModule("src/features/home/utils/globeTiles.ts");
const rome = { latitude: 41.9, longitude: 12.5 };
const paris = { latitude: 48.86, longitude: 2.35 };
const tokyo = { latitude: 35.68, longitude: 139.69 };
const fiji = { latitude: -17.7, longitude: 178.0 };
const samoa = { latitude: -13.8, longitude: -171.8 };

function covers(box, point) {
  const deg = tiles.boxDegrees(box);
  const east = (((point.longitude - deg.west) % 360) + 360) % 360;
  return east <= deg.width && point.latitude >= deg.south && point.latitude <= deg.south + deg.height;
}

test("a single stop gets the sharpest level within 3x3 tiles", () => {
  const box = tiles.tileBoxFor([rome], 2);
  assert.equal(box.level, 7);
  assert.ok(box.cols <= 3 && box.rows <= 3);
  assert.ok(covers(box, rome));
});

test("low-memory phones get at most 2x2 tiles per box", () => {
  const box = tiles.tileBoxFor([rome], 2, 2);
  assert.ok(box.cols <= 2 && box.rows <= 2);
  assert.ok(box.level < 7);
  assert.ok(covers(box, rome));
});

test("a wider route drops to a coarser level but still covers every stop", () => {
  const box = tiles.tileBoxFor([rome, paris], 4);
  assert.ok(box.level < 7 && box.level >= 3);
  assert.ok(covers(box, rome) && covers(box, paris));
});

test("routes across the antimeridian stay contiguous", () => {
  const box = tiles.tileBoxFor([fiji, samoa], 2);
  assert.ok(box);
  assert.ok(tiles.boxDegrees(box).width < 40);
  assert.ok(covers(box, fiji) && covers(box, samoa));
});

test("routes too spread out for a sharper box get none", () => {
  assert.equal(tiles.tileBoxFor([paris, tokyo], 40), null);
});

test("today's stop splits the trip days evenly", () => {
  const stops = [rome, paris, tokyo];
  assert.deepEqual([1, 4, 5, 7, 8, 10].map((day) => tiles.todayStopIndex(stops, "active", day, 10)), [0, 0, 1, 1, 2, 2]);
});

test("before the trip it's the first stop, after it the last", () => {
  const stops = [rome, paris, tokyo];
  assert.equal(tiles.todayStopIndex(stops, "upcoming", 0, 10), 0);
  assert.equal(tiles.todayStopIndex(stops, "complete", 10, 10), 2);
});

test("being near a stop beats the day split", () => {
  const stops = [rome, paris, tokyo];
  assert.equal(tiles.todayStopIndex(stops, "active", 1, 10, { latitude: 35.7, longitude: 139.7 }), 2);
  assert.equal(tiles.todayStopIndex(stops, "active", 1, 10, { latitude: 0, longitude: 0 }), 0);
});
