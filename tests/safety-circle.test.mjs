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

const { batteryMode, buildCircle, SHARE_STALE_AFTER_MS } = loadModule("src/features/location-sharing/utils/circle.ts");

const NOW = 1_800_000_000_000;
const empty = { outgoing: [], incoming: [], invites: [], incomingShares: [], outgoingShares: [], now: NOW };

test("battery mode drops to low and comes back with a gap between the levels", () => {
  assert.equal(batteryMode("normal", 0.5), "normal");
  assert.equal(batteryMode("normal", 0.2), "low");
  assert.equal(batteryMode("low", 0.25), "low");
  assert.equal(batteryMode("low", 0.3), "normal");
  assert.equal(batteryMode("normal", null), "normal");
  assert.equal(batteryMode("normal", -1), "normal");
});

test("battery mode never changes an SOS share", () => {
  assert.equal(batteryMode("emergency", 0.05), "emergency");
});

test("someone you added who also shares with you is one person", () => {
  const circle = buildCircle({
    ...empty,
    outgoing: [{ id: "l1", linkedUserId: "u1", name: "Mia", email: "mia@x.com", status: "accepted" }],
    incoming: [{ id: "l2", ownerUserId: "u1", ownerName: "Mia R", ownerEmail: "mia@x.com", status: "accepted" }],
    incomingShares: [{ ownerUserId: "u1", ownerName: "Mia R", latitude: 1, longitude: 2, battery: 0.8, updatedAt: NOW - 60_000 }],
  });
  assert.equal(circle.people.length, 1);
  assert.equal(circle.people[0].name, "Mia");
  assert.equal(circle.people[0].location?.stale, false);
  assert.equal(circle.alertCount, 1);
  assert.equal(circle.sharingWithYou.length, 1);
});

test("paused people still get alerts but don't see you", () => {
  const circle = buildCircle({
    ...empty,
    outgoing: [
      { id: "l1", linkedUserId: "u1", name: "Mia", email: "mia@x.com", status: "accepted" },
      { id: "l2", linkedUserId: "u2", name: "Leo", email: "leo@x.com", status: "accepted" },
    ],
    outgoingShares: [{ recipientUserId: "u2", paused: true }],
  });
  assert.equal(circle.alertCount, 2);
  assert.equal(circle.seesYouCount, 1);
});

test("pending, declined and invited people don't count as alerted", () => {
  const circle = buildCircle({
    ...empty,
    outgoing: [
      { id: "l1", linkedUserId: "u1", name: "Ana", email: "a@x.com", status: "pending" },
      { id: "l2", linkedUserId: "u2", name: "Ben", email: "b@x.com", status: "declined" },
    ],
    invites: [{ id: "i1", name: "Cy", email: "c@x.com", phone: null }],
  });
  assert.equal(circle.alertCount, 0);
  assert.deepEqual(circle.people.map((p) => p.status), ["pending", "invited", "declined"]);
});

test("requests list only pending incoming links; accepted incoming links show as people", () => {
  const circle = buildCircle({
    ...empty,
    incoming: [
      { id: "r1", ownerUserId: "u1", ownerName: "Dee", ownerEmail: "d@x.com", status: "pending" },
      { id: "r2", ownerUserId: "u2", ownerName: "Eve", ownerEmail: "e@x.com", status: "accepted" },
    ],
  });
  assert.deepEqual(circle.requests, [{ linkId: "r1", name: "Dee", email: "d@x.com" }]);
  assert.deepEqual(circle.people.map((p) => [p.name, p.status]), [["Eve", "none"]]);
});

test("shares go stale and placeholder shares at 0,0 are ignored", () => {
  const circle = buildCircle({
    ...empty,
    incomingShares: [
      { ownerUserId: "u1", ownerName: "Old", latitude: 5, longitude: 5, battery: null, updatedAt: NOW - SHARE_STALE_AFTER_MS - 1 },
      { ownerUserId: "u2", ownerName: "Zero", latitude: 0, longitude: 0, battery: null, updatedAt: NOW },
    ],
  });
  assert.equal(circle.people.length, 1);
  assert.equal(circle.people[0].location?.stale, true);
});
