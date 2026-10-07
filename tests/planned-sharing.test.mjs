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
    alias: { "@": "./src" },
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

const details = loadModule("src/features/sync/utils/groupDetails.ts");

const shared = { groupId: "s1", myMemberId: "m2", role: "member", inviteCode: "ABC", archived: false, muted: false, members: [] };
const planned = { kind: "planned", id: "g-s1", name: "Bali", destinations: ["Bali"], month: "2027-03", companions: [], createdAt: "2026-10-01T00:00:00.000Z" };

test("a planned trip shares its kind, places and month, never dates", () => {
  const out = details.groupDetails(planned);
  assert.equal(out.kind, "planned");
  assert.equal(out.month, "2027-03");
  assert.equal("startDate" in out, false);
});

test("confirming turns a member's planned copy into a group trip with the same id", () => {
  const confirmed = { name: "Bali", destinations: ["Bali"], startDate: "2027-03-03", endDate: "2027-03-10", budget: 0, currency: "INR", createdAt: planned.createdAt };
  const out = details.mergeDetails(planned, confirmed, ["Sam"], shared);
  assert.equal(out.id, "g-s1");
  assert.equal(out.kind, undefined);
  assert.equal(out.month, undefined);
  assert.equal(out.startDate, "2027-03-03");
  assert.equal(out.mode, "group");
  assert.deepEqual(out.companions, ["Sam"]);
});

test("planned details from the server keep it planned", () => {
  const out = details.mergeDetails(planned, { ...details.groupDetails(planned), name: "Bali & Lombok" }, ["Sam"], shared);
  assert.equal(out.kind, "planned");
  assert.equal(out.name, "Bali & Lombok");
  assert.equal(out.mode, undefined);
});
