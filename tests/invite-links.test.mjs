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

const { inviteFromPath, inviteFromReferrer, inviteFromUrl } = loadModule("src/features/trips/utils/inviteLinks.ts");

const SITE = "https://happy-otter-123.convex.site";
const WEB = "https://nomadsafe.example.com";
const group = (code) => ({ kind: "group", code });
const circle = (code) => ({ kind: "circle", code });

test("path parsing accepts deep link paths and uppercases the code", () => {
  assert.deepEqual(inviteFromPath("join/ab12cd"), group("AB12CD"));
  assert.deepEqual(inviteFromPath("/join/AB12CD/"), group("AB12CD"));
  assert.deepEqual(inviteFromPath("/join/AB12CD?x=1"), group("AB12CD"));
  assert.equal(inviteFromPath("/join/A"), null);
  assert.equal(inviteFromPath("/trips/AB12CD"), null);
});

test("circle links parse as circle invites, and the bare circle screen isn't one", () => {
  assert.deepEqual(inviteFromPath("circle/ab12cd"), circle("AB12CD"));
  assert.deepEqual(inviteFromPath("/circle/AB12CD/"), circle("AB12CD"));
  assert.deepEqual(inviteFromPath("nomadsafe://circle/AB12CDEF23"), circle("AB12CDEF23"));
  assert.equal(inviteFromPath("/circle"), null);
  assert.equal(inviteFromPath("circle"), null);
  assert.equal(inviteFromPath("/circle/AB"), null);
  assert.equal(inviteFromPath("/circle-invite/AB12CD"), null);
});

test("Play referrer yields the join or circle code alongside Play's own params", () => {
  assert.deepEqual(inviteFromReferrer("join=AB12CD"), group("AB12CD"));
  assert.deepEqual(inviteFromReferrer("utm_source=google-play&utm_medium=organic&join=ab12cd"), group("AB12CD"));
  assert.deepEqual(inviteFromReferrer("circle=ab12cd"), circle("AB12CD"));
  assert.deepEqual(inviteFromReferrer("utm_source=google-play&utm_medium=organic&circle=AB12CD"), circle("AB12CD"));
  assert.equal(inviteFromReferrer("utm_source=google-play&utm_medium=organic"), null);
  assert.equal(inviteFromReferrer("join=../evil"), null);
  assert.equal(inviteFromReferrer("circle=../evil"), null);
  assert.equal(inviteFromReferrer(""), null);
});

test("clipboard URLs only count when they're our own invite links", () => {
  assert.deepEqual(inviteFromUrl(`${SITE}/join/AB12CD`, [SITE]), group("AB12CD"));
  assert.deepEqual(inviteFromUrl(`${WEB}/join/AB12CD`, [WEB, SITE]), group("AB12CD"));
  assert.deepEqual(inviteFromUrl(`${SITE}/join/AB12CD`, [WEB, SITE]), group("AB12CD"));
  assert.deepEqual(inviteFromUrl(`${WEB}/circle/AB12CD`, [WEB, SITE]), circle("AB12CD"));
  assert.equal(inviteFromUrl("https://evil.example/join/AB12CD", [WEB, SITE]), null);
  assert.equal(inviteFromUrl("https://evil.example/circle/AB12CD", [WEB, SITE]), null);
  assert.equal(inviteFromUrl(`${SITE}/privacy`, [SITE]), null);
  assert.equal(inviteFromUrl("not a url", [SITE]), null);
});
