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

const { hashOf } = loadModule("src/features/sync/utils/hash.ts");

test("hash ignores key order, so a record round-tripped through the server isn't re-pushed", () => {
  const local = { id: "1", amount: 12.5, shares: [{ person: "a", amount: 6.25 }], paidBy: "m1" };
  const fromServer = { shares: [{ amount: 6.25, person: "a" }], paidBy: "m1", amount: 12.5, id: "1" };
  assert.equal(hashOf(local), hashOf(fromServer));
});

test("hash treats undefined fields as absent", () => {
  assert.equal(hashOf({ a: 1, b: undefined }), hashOf({ a: 1 }));
});

test("hash changes when a value changes", () => {
  assert.notEqual(hashOf({ amount: 10 }), hashOf({ amount: 11 }));
  assert.notEqual(hashOf({ shares: [{ person: "a" }, { person: "b" }] }), hashOf({ shares: [{ person: "b" }, { person: "a" }] }));
});
