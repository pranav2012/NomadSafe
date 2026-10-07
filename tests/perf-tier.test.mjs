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

const perf = loadModule("src/utils/perfTier.ts");
const GB = 1024 ** 3;
const base = { os: "android", totalMemory: 11.4 * GB, apiLevel: 35, yearClass: 2016, lowPower: false, governorDrops: 0 };

test("marketed RAM rounds up the OS total", () => {
  assert.equal(perf.ramGb(3.7 * GB), 4);
  assert.equal(perf.ramGb(7.4 * GB), 8);
  assert.equal(perf.ramGb(null), 0);
});

test("Android tiers by RAM and OS version", () => {
  assert.equal(perf.computePerfTier(base), "high");
  assert.equal(perf.computePerfTier({ ...base, totalMemory: 7.4 * GB }), "high");
  assert.equal(perf.computePerfTier({ ...base, totalMemory: 5.6 * GB }), "mid");
  assert.equal(perf.computePerfTier({ ...base, totalMemory: 3.7 * GB }), "low");
  assert.equal(perf.computePerfTier({ ...base, apiLevel: 29 }), "low");
  assert.equal(perf.computePerfTier({ ...base, yearClass: 2013 }), "low");
  assert.equal(perf.computePerfTier({ ...base, totalMemory: null }), "high");
});

test("iPhones with 4 GB or more are high", () => {
  const ios = { ...base, os: "ios", apiLevel: null, yearClass: 2019 };
  assert.equal(perf.computePerfTier({ ...ios, totalMemory: 5.6 * GB }), "high");
  assert.equal(perf.computePerfTier({ ...ios, totalMemory: 3.7 * GB }), "high");
  assert.equal(perf.computePerfTier({ ...ios, totalMemory: 2.8 * GB }), "mid");
  assert.equal(perf.computePerfTier({ ...ios, totalMemory: 1.9 * GB }), "low");
});

test("low power mode and the governor lower the tier", () => {
  assert.equal(perf.computePerfTier({ ...base, lowPower: true }), "low");
  assert.equal(perf.computePerfTier({ ...base, governorDrops: 1 }), "mid");
  assert.equal(perf.computePerfTier({ ...base, totalMemory: 5.6 * GB, governorDrops: 3 }), "low");
});

test("governor drops a tier only when most frames are slow", () => {
  assert.equal(perf.shouldDropTier(20, 40), false);
  assert.equal(perf.shouldDropTier(21, 40), true);
  assert.equal(perf.shouldDropTier(10, 12), false);
});
