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

const rules = loadModule("convex/weatherRules.ts");

const entry = (time, temp, { sym1, sym6, rain1, rain6, max6, min6, uv, cloud = 50, feels = temp } = {}) => ({
  time,
  data: {
    instant: { details: { air_temperature: temp, apparent_air_temperature: feels, cloud_area_fraction: cloud, ultraviolet_index_clear_sky: uv } },
    ...(sym1 ? { next_1_hours: { summary: { symbol_code: sym1 }, details: { precipitation_amount: rain1 ?? 0 } } } : {}),
    ...(sym6 ? { next_6_hours: { summary: { symbol_code: sym6 }, details: { precipitation_amount: rain6 ?? 0, air_temperature_max: max6, air_temperature_min: min6 } } } : {}),
  },
});

test("MET symbols map to WMO codes, most severe highest", () => {
  assert.equal(rules.symbolToWmo("clearsky_night"), 0);
  assert.equal(rules.symbolToWmo("partlycloudy_day"), 2);
  assert.equal(rules.symbolToWmo("cloudy"), 3);
  assert.equal(rules.symbolToWmo("fog"), 45);
  assert.equal(rules.symbolToWmo("lightrain"), 61);
  assert.equal(rules.symbolToWmo("heavyrainshowers_day"), 82);
  assert.equal(rules.symbolToWmo("snow"), 73);
  assert.equal(rules.symbolToWmo("lightssnowshowersandthunder_day"), 95);
  assert.equal(rules.symbolToWmo(null), null);
});

test("daily summaries use hourly steps, then the 6-hourly tail", () => {
  // Longitude 0: UTC days are local days.
  const steps = rules.parseMetSteps({
    properties: {
      timeseries: [
        entry("2026-10-05T09:00:00Z", 18, { sym1: "clearsky_day", rain1: 0, uv: 4, sym6: "rain", rain6: 9 }),
        entry("2026-10-05T12:00:00Z", 22, { sym1: "lightrain", rain1: 2, uv: 6, feels: 24 }),
        entry("2026-10-05T21:00:00Z", 15, { sym1: "clearsky_night", rain1: 0 }),
        entry("2026-10-06T06:00:00Z", 14, { sym6: "rainshowers_day", rain6: 3, max6: 19, min6: 13 }),
        entry("2026-10-06T12:00:00Z", 20, { sym6: "cloudy", rain6: 1, max6: 21, min6: 19 }),
      ],
    },
  });
  const days = rules.dailyForecast(steps, 0);
  assert.equal(days.length, 2);
  assert.deepEqual(days[0], { date: "2026-10-05", weatherCode: 61, tempMax: 22, tempMin: 15, feelsLike: 24, uvIndex: 6, precipMm: 2 });
  assert.deepEqual(days[1], { date: "2026-10-06", weatherCode: 81, tempMax: 21, tempMin: 13, feelsLike: 20, uvIndex: null, precipMm: 4 });
});

test("local days shift by the destination's solar offset", () => {
  const steps = rules.parseMetSteps({ properties: { timeseries: [entry("2026-10-05T20:00:00Z", 10, { sym1: "cloudy" })] } });
  assert.equal(rules.dailyForecast(steps, 139.7)[0].date, "2026-10-06");
  assert.equal(rules.dailyForecast(steps, -74)[0].date, "2026-10-05");
});

test("the hourly outlook starts an hour back and carries day or night from the symbol", () => {
  const steps = rules.parseMetSteps({
    properties: {
      timeseries: [
        entry("2026-10-04T23:00:00Z", 13, { sym1: "cloudy" }),
        entry("2026-10-05T01:00:00Z", 12, { sym1: "clearsky_night" }),
        entry("2026-10-05T02:00:00Z", 11, { sym1: "fair_day" }),
        entry("2026-10-05T06:00:00Z", 10, { sym6: "rain" }),
      ],
    },
  });
  const now = Date.parse("2026-10-05T01:30:00Z");
  assert.deepEqual(rules.hourlyOutlook(steps, now), [
    { t: Date.parse("2026-10-05T01:00:00Z"), temperature: 12, weatherCode: 0, isDay: false },
    { t: Date.parse("2026-10-05T02:00:00Z"), temperature: 11, weatherCode: 1, isDay: true },
  ]);
  assert.deepEqual(rules.cloudCell(steps, now), { cover: 0.5, storm: false });
});

test("weather cells round to 0.1° and wrap longitude", () => {
  assert.deepEqual(rules.weatherCell(41.9028, 12.4964), { lat: 41.9, lng: 12.5, key: "41.9,12.5" });
  assert.equal(rules.weatherCell(10, 190).lng, -170);
});
