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

const { inviteCodeFromPath, inviteCodeFromReferrer, inviteCodeFromUrl } = loadModule("src/features/trips/utils/inviteLinks.ts");

const SITE = "https://happy-otter-123.convex.site";
const WEB = "https://nomadsafe.example.com";

test("path parsing accepts deep link paths and uppercases the code", () => {
  assert.equal(inviteCodeFromPath("join/ab12cd"), "AB12CD");
  assert.equal(inviteCodeFromPath("/join/AB12CD/"), "AB12CD");
  assert.equal(inviteCodeFromPath("/join/AB12CD?x=1"), "AB12CD");
  assert.equal(inviteCodeFromPath("/join/A"), null);
  assert.equal(inviteCodeFromPath("/trips/AB12CD"), null);
});

test("Play referrer yields the join code alongside Play's own params", () => {
  assert.equal(inviteCodeFromReferrer("join=AB12CD"), "AB12CD");
  assert.equal(inviteCodeFromReferrer("utm_source=google-play&utm_medium=organic&join=ab12cd"), "AB12CD");
  assert.equal(inviteCodeFromReferrer("utm_source=google-play&utm_medium=organic"), null);
  assert.equal(inviteCodeFromReferrer("join=../evil"), null);
  assert.equal(inviteCodeFromReferrer(""), null);
});

test("clipboard URLs only count when they're our own invite links", () => {
  assert.equal(inviteCodeFromUrl(`${SITE}/join/AB12CD`, [SITE]), "AB12CD");
  assert.equal(inviteCodeFromUrl(`${WEB}/join/AB12CD`, [WEB, SITE]), "AB12CD");
  assert.equal(inviteCodeFromUrl(`${SITE}/join/AB12CD`, [WEB, SITE]), "AB12CD");
  assert.equal(inviteCodeFromUrl("https://evil.example/join/AB12CD", [WEB, SITE]), null);
  assert.equal(inviteCodeFromUrl(`${SITE}/privacy`, [SITE]), null);
  assert.equal(inviteCodeFromUrl("not a url", [SITE]), null);
});
