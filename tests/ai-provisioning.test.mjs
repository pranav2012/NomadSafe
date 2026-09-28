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

const catalog = loadModule("src/features/ai/services/modelCatalog.ts");
const { pickModelForDevice, nominalRamGb, findModel, AI_MODELS, STORAGE_HEADROOM_BYTES, GB } = catalog;

const PLENTY = 64 * GB;
const size = (id) => AI_MODELS.find((m) => m.id === id).sizeBytes;
const fits = (id) => size(id) + STORAGE_HEADROOM_BYTES;

test("RAM tiers at the boundaries", () => {
  const cases = [
    [2.9, null],
    [3, "lite"],
    [3.9, "lite"],
    [4, "base"],
    [7.9, "base"],
    [8, "pro"],
    [12, "pro"],
  ];
  for (const [totalRamGb, expected] of cases) {
    const pick = pickModelForDevice({ totalRamGb, freeBytes: PLENTY });
    assert.equal(pick.model?.id ?? null, expected, `${totalRamGb} GB`);
    assert.equal(pick.reason, expected ? "ok" : "unsupportedDevice", `${totalRamGb} GB reason`);
    assert.equal(pick.downgraded, false);
  }
});

test("low storage drops one tier at a time", () => {
  const justUnderPro = pickModelForDevice({ totalRamGb: 8, freeBytes: fits("pro") - 1 });
  assert.equal(justUnderPro.model.id, "base");
  assert.equal(justUnderPro.downgraded, true);

  const exactlyPro = pickModelForDevice({ totalRamGb: 8, freeBytes: fits("pro") });
  assert.equal(exactlyPro.model.id, "pro");
  assert.equal(exactlyPro.downgraded, false);

  const onlyLite = pickModelForDevice({ totalRamGb: 8, freeBytes: fits("base") - 1 });
  assert.equal(onlyLite.model.id, "lite");
  assert.equal(onlyLite.downgraded, true);

  const baseTierToLite = pickModelForDevice({ totalRamGb: 4, freeBytes: fits("lite") });
  assert.equal(baseTierToLite.model.id, "lite");
  assert.equal(baseTierToLite.downgraded, true);
});

test("nothing fits reports insufficient storage", () => {
  for (const totalRamGb of [3, 4, 8]) {
    const pick = pickModelForDevice({ totalRamGb, freeBytes: fits("lite") - 1 });
    assert.equal(pick.model, null);
    assert.equal(pick.reason, "insufficientStorage");
    assert.equal(pick.downgraded, false);
  }
});

test("unsupported RAM wins over storage", () => {
  const pick = pickModelForDevice({ totalRamGb: 2, freeBytes: 1 });
  assert.equal(pick.reason, "unsupportedDevice");
});

test("unknown free storage assumes the tier fits", () => {
  for (const freeBytes of [null, 0, Number.NaN]) {
    assert.equal(pickModelForDevice({ totalRamGb: 8, freeBytes }).model.id, "pro");
  }
});

test("bytes already on disk are credited to that model", () => {
  // A finished pro download must not push itself out on the next launch.
  const pick = pickModelForDevice({
    totalRamGb: 8,
    freeBytes: STORAGE_HEADROOM_BYTES,
    presentBytes: { pro: size("pro") },
  });
  assert.equal(pick.model.id, "pro");
  const other = pickModelForDevice({
    totalRamGb: 8,
    freeBytes: STORAGE_HEADROOM_BYTES,
    presentBytes: { lite: size("lite") },
  });
  assert.equal(other.model.id, "lite");
});

test("nominal RAM rounds OS-reported totals up to the marketed size", () => {
  assert.equal(nominalRamGb(7.4 * GB), 8);
  assert.equal(nominalRamGb(3.6 * GB), 4);
  assert.equal(nominalRamGb(2.7 * GB), 3);
  assert.equal(nominalRamGb(1.8 * GB), 2);
  assert.equal(nominalRamGb(4 * GB), 4);
  assert.equal(nominalRamGb(0), 0);
  assert.equal(nominalRamGb(null), 0);
});

test("legacy ids map to the model with the same file", () => {
  assert.equal(findModel("compact").id, "lite");
  assert.equal(findModel("balanced").id, "pro");
  assert.equal(findModel("base").id, "base");
  assert.equal(findModel("nope"), null);
  for (const model of AI_MODELS) {
    assert.match(model.url, new RegExp(`^https://huggingface\\.co/${model.hfRepoId}/resolve/${model.revision}/${model.hfFilename}$`));
    assert.match(model.sha256, /^[0-9a-f]{64}$/);
  }
});
