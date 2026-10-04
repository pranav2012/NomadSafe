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

const { isOpenAt } = loadModule("src/features/places/utils/openingHours.ts");

const DAY = 24 * 60;
const at = (day, hour, minute = 0) => (day * 24 + hour) * 60 + minute;
// 2026-10-04 is a Sunday; UTC midnight.
const sundayUtc = Date.UTC(2026, 9, 4);
const utcTime = (day, hour, minute = 0) => sundayUtc + (day * DAY + hour * 60 + minute) * 60_000;

test("open inside a same-day window, closed outside it", () => {
  const hours = { utcOffsetMinutes: 0, windows: [[at(1, 9), at(1, 17)]] };
  assert.equal(isOpenAt(hours, utcTime(1, 12)), true);
  assert.equal(isOpenAt(hours, utcTime(1, 17)), false);
  assert.equal(isOpenAt(hours, utcTime(1, 8, 59)), false);
});

test("uses the place's own time zone, not the device's", () => {
  // 09:00–17:00 in UTC+5:30; 04:00 UTC is 09:30 local.
  const hours = { utcOffsetMinutes: 330, windows: [[at(1, 9), at(1, 17)]] };
  assert.equal(isOpenAt(hours, utcTime(1, 4)), true);
  assert.equal(isOpenAt(hours, utcTime(1, 12)), false);
});

test("a window past midnight counts on both days", () => {
  const hours = { utcOffsetMinutes: 0, windows: [[at(5, 18), at(6, 2)]] };
  assert.equal(isOpenAt(hours, utcTime(5, 23)), true);
  assert.equal(isOpenAt(hours, utcTime(6, 1)), true);
  assert.equal(isOpenAt(hours, utcTime(6, 3)), false);
});

test("Saturday night into Sunday wraps the week", () => {
  const hours = { utcOffsetMinutes: 0, windows: [[at(6, 22), at(0, 2)]] };
  assert.equal(isOpenAt(hours, utcTime(6, 23)), true);
  assert.equal(isOpenAt(hours, utcTime(0, 1)), true);
  assert.equal(isOpenAt(hours, utcTime(0, 3)), false);
});

test("a window with no close is always open", () => {
  assert.equal(isOpenAt({ utcOffsetMinutes: 0, windows: [[0, null]] }, utcTime(3, 4)), true);
});
