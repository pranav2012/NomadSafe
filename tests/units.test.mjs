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

const units = loadModule("src/utils/units.ts");
const label = (unit, value) => `${value} ${unit}`;

test("device prefs follow the phone's region", () => {
  assert.deepEqual(units.deviceUnitPrefs("us", null), { temperature: "F", distance: "mi", rain: "in" });
  assert.deepEqual(units.deviceUnitPrefs("uk", "celsius"), { temperature: "C", distance: "mi", rain: "mm" });
  assert.deepEqual(units.deviceUnitPrefs("metric", "fahrenheit"), { temperature: "F", distance: "km", rain: "mm" });
  assert.deepEqual(units.deviceUnitPrefs(null, null), { temperature: "C", distance: "km", rain: "mm" });
});

test("an explicit unit system overrides the phone", () => {
  const us = units.deviceUnitPrefs("us", "fahrenheit");
  assert.equal(units.resolveUnitPrefs(null, us), us);
  assert.equal(units.resolveUnitPrefs("metric", us).distance, "km");
  assert.equal(units.resolveUnitPrefs("imperial", units.deviceUnitPrefs("metric", null)).temperature, "F");
});

test("temperatures convert and round", () => {
  assert.equal(units.toTemperature(20, "F"), 68);
  assert.equal(units.toTemperature(-40, "F"), -40);
  assert.equal(units.toTemperature(21.6, "C"), 22);
});

test("metric distances", () => {
  assert.equal(units.formatDistance(0.347, "km", "en", label), "350 m");
  assert.equal(units.formatDistance(0.001, "km", "en", label), "10 m");
  assert.equal(units.formatDistance(1.23, "km", "en", label), "1.2 km");
  assert.equal(units.formatDistance(11143.2, "km", "en", label), "11,143 km");
  assert.equal(units.formatDistance(11143.2, "km", "de", label), "11.143 km");
});

test("imperial distances", () => {
  assert.equal(units.formatDistance(0.1, "mi", "en", label), "330 ft");
  assert.equal(units.formatDistance(2, "mi", "en", label), "1.2 mi");
  assert.equal(units.formatDistance(11143, "mi", "en", label), "6,924 mi");
});

test("rain in mm or inches", () => {
  assert.equal(units.formatRain(0.4, "mm", "en", label), "1 mm");
  assert.equal(units.formatRain(12.6, "mm", "en", label), "13 mm");
  assert.equal(units.formatRain(4, "in", "en", label), "0.16 in");
  assert.equal(units.formatRain(0.1, "in", "en", label), "0.01 in");
  assert.equal(units.formatRain(50, "in", "en", label), "2 in");
});

test("approximate durations round to the quarter hour", () => {
  assert.equal(units.formatApproxDuration(8.5, "en", label), "~8 h 30 min");
  assert.equal(units.formatApproxDuration(12, "en", label), "~12 h");
  assert.equal(units.formatApproxDuration(0.05, "en", label), "~15 min");
});

test("compact counts", () => {
  assert.equal(units.formatCompactNumber(980, "en"), "980");
  assert.equal(units.formatCompactNumber(1234, "en"), "1.2K");
  assert.equal(units.formatCompactNumber(12345, "en"), "12K");
  assert.equal(units.formatCompactNumber(2_500_000, "en"), "2.5M");
});

test("clock: user pick, then the phone, then the language", () => {
  assert.equal(units.uses12HourClock("24h", false, "en"), false);
  assert.equal(units.uses12HourClock("12h", true, "de"), true);
  assert.equal(units.uses12HourClock(null, true, "en"), false);
  assert.equal(units.uses12HourClock(null, false, "de"), true);
  assert.equal(units.uses12HourClock(null, null, "en"), true);
  assert.equal(units.uses12HourClock(null, null, "de"), false);
});
