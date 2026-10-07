import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

function loadModule(entryPoint) {
  const output = buildSync({ entryPoints: [entryPoint], bundle: true, format: "cjs", platform: "node", target: "node20", write: false }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("module", "exports", output)(module, module.exports);
  return module.exports;
}

const mrz = loadModule("src/features/passport/utils/mrz.ts");

test("check digits follow ICAO 9303", () => {
  // Specimen values from ICAO 9303 part 4.
  assert.equal(mrz.checkDigit("L898902C3"), "6");
  assert.equal(mrz.checkDigit("740812"), "2");
  assert.equal(mrz.checkDigit("120415"), "9");
  assert.equal(mrz.checkDigit("<<<<<<"), "0");
});

test("passport numbers are stable, two letters and seven digits", () => {
  const a = mrz.passportNumber("user_123");
  assert.match(a, /^[A-Z]{2}\d{7}$/);
  assert.equal(a, mrz.passportNumber("user_123"));
  assert.notEqual(a, mrz.passportNumber("user_124"));
});

test("names are transliterated to A-Z and non-Latin text is dropped", () => {
  assert.equal(mrz.mrzText("José Ñúñez-Ølsen"), "JOSE<NUNEZ<OLSEN");
  assert.equal(mrz.mrzText("Grüße O'Brien"), "GRUSSE<OBRIEN");
  assert.equal(mrz.mrzText("प्रणव"), "");
  assert.equal(mrz.iso3("in"), "IND");
  assert.equal(mrz.iso3(null), "XXX");
});

test("both MRZ lines are 44 characters with valid check digits", () => {
  const [one, two] = mrz.buildMrz({ name: "Pranav Agarwal", home: "US", number: "AB1234567", issued: "2026-09-09", countries: 2, continents: 2, daysAbroad: 27 });
  assert.equal(one.length, 44);
  assert.equal(two.length, 44);
  assert.ok(one.startsWith("P<USAAGARWAL<<PRANAV<"));
  assert.match(one, /^[A-Z<]+$/);
  assert.match(two, /^[A-Z0-9<]+$/);
  assert.equal(two.slice(0, 9), "AB1234567");
  assert.equal(two[9], mrz.checkDigit("AB1234567"));
  assert.equal(two.slice(10, 13), "USA");
  assert.equal(two.slice(13, 19), "260909");
  assert.equal(two.slice(21, 27), "360909");
  const composite = two.slice(0, 10) + two.slice(13, 20) + two.slice(21, 43);
  assert.equal(two[43], mrz.checkDigit(composite));
});

test("a missing issue date and a name with no Latin letters still fill the lines", () => {
  const [one, two] = mrz.buildMrz({ name: "プラナフ", home: null, number: "ZZ0000001", issued: null, countries: 0, continents: 0, daysAbroad: 0 });
  assert.equal(one, "P<XXX".padEnd(44, "<"));
  assert.equal(two.length, 44);
  assert.equal(two.slice(13, 19), "<<<<<<");
});
