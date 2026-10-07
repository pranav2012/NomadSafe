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

const {
  backoffMs,
  chooseProfile,
  distanceMeters,
  HEARTBEAT_MS,
  initialProfile,
  isAuthError,
  profileSpec,
  publishDecision,
  roundBattery,
  STILL_MOTION,
  updateMotion,
} = loadModule("src/features/location-sharing/utils/broadcastPolicy.ts");
const { nextStaleAt, SHARE_STALE_AFTER_MS } = loadModule("src/features/location-sharing/utils/circle.ts");

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const HOME = { latitude: 48.8566, longitude: 2.3522 };
// About 1 m of latitude.
const M = 1 / 111_195;

const fix = (overrides = {}) => ({ ...HOME, accuracy: 20, speed: 0, timestamp: T0, ...overrides });
const fold = (fixes) => fixes.reduce(updateMotion, STILL_MOTION);

test("distance is in metres", () => {
  const d = distanceMeters(HOME, { latitude: HOME.latitude + 100 * M, longitude: HOME.longitude });
  assert.ok(Math.abs(d - 100) < 1, String(d));
});

test("still after 5 minutes within 50 m", () => {
  const near = [0, 1, 2, 3, 4].map((i) => fix({ latitude: HOME.latitude + (i % 2) * 30 * M, timestamp: T0 + i * MIN }));
  assert.equal(fold(near).still, false);
  const motion = fold([...near, fix({ timestamp: T0 + 5 * MIN })]);
  assert.equal(motion.still, true);
  assert.equal(motion.anchor.since, T0);
});

test("a wide fix stretches the still tolerance only up to 150 m", () => {
  const start = fix({ accuracy: 120 });
  const drift = fix({ latitude: HOME.latitude + 110 * M, accuracy: 120, timestamp: T0 + 5 * MIN });
  assert.equal(fold([start, drift]).still, true);
  const far = fix({ latitude: HOME.latitude + 200 * M, accuracy: 400, timestamp: T0 + 5 * MIN });
  assert.equal(fold([fix({ accuracy: 400 }), far]).still, false);
});

test("moving resets the still clock", () => {
  const motion = fold([
    fix(),
    fix({ latitude: HOME.latitude + 80 * M, timestamp: T0 + 3 * MIN }),
    fix({ latitude: HOME.latitude + 80 * M, timestamp: T0 + 6 * MIN }),
  ]);
  assert.equal(motion.still, false);
  assert.equal(motion.anchor.since, T0 + 3 * MIN);
});

test("walking speed with a near fix does not count as still", () => {
  const motion = fold([fix(), fix({ speed: 1.6, timestamp: T0 + 6 * MIN })]);
  assert.equal(motion.still, false);
});

test("leaving the still radius or walking off ends still", () => {
  const still = fold([fix(), fix({ timestamp: T0 + 5 * MIN })]);
  assert.equal(still.still, true);
  assert.equal(updateMotion(still, fix({ latitude: HOME.latitude + 120 * M, timestamp: T0 + 6 * MIN })).still, true);
  assert.equal(updateMotion(still, fix({ latitude: HOME.latitude + 200 * M, timestamp: T0 + 6 * MIN })).still, false);
  // A noisy wide fix inside its own uncertainty doesn't end it.
  assert.equal(updateMotion(still, fix({ latitude: HOME.latitude + 200 * M, accuracy: 300, timestamp: T0 + 6 * MIN })).still, true);
  assert.equal(updateMotion(still, fix({ speed: 2.5, timestamp: T0 + 6 * MIN })).still, false);
});

test("driving speed switches with a gap so it doesn't flap", () => {
  let motion = fold([fix({ speed: 10 })]);
  assert.equal(motion.fast, true);
  motion = updateMotion(motion, fix({ latitude: HOME.latitude + 500 * M, speed: 5, timestamp: T0 + MIN }));
  assert.equal(motion.fast, true);
  motion = updateMotion(motion, fix({ latitude: HOME.latitude + 900 * M, speed: 3, timestamp: T0 + 2 * MIN }));
  assert.equal(motion.fast, false);
  // iOS reports -1 for unknown speed; treat as unknown.
  assert.equal(updateMotion({ ...motion, fast: true }, fix({ latitude: HOME.latitude + 1500 * M, speed: null, timestamp: T0 + 3 * MIN })).fast, true);
});

test("profiles follow mode and motion", () => {
  const still = { anchor: null, still: true, fast: false };
  const driving = { anchor: null, still: false, fast: true };
  assert.equal(initialProfile("normal"), "walk");
  assert.equal(initialProfile("low"), "low");
  assert.equal(initialProfile("emergency"), "sos");
  assert.equal(chooseProfile("normal", driving), "drive");
  assert.equal(chooseProfile("low", driving), "low");
  assert.equal(chooseProfile("normal", still), "still");
  assert.equal(chooseProfile("low", still), "still");
  assert.equal(chooseProfile("emergency", still), "sosStill");
  assert.equal(chooseProfile("emergency", driving), "sos");
});

test("profile cadence", () => {
  assert.equal(profileSpec("walk", "android").publishIntervalMs, MIN);
  assert.equal(profileSpec("drive", "android").publishIntervalMs, 30_000);
  assert.equal(profileSpec("sos", "android").publishIntervalMs, 15_000);
  assert.equal(profileSpec("sos", "android").accuracy, "high");
  assert.equal(profileSpec("sosStill", "ios").publishIntervalMs, MIN);
  const still = profileSpec("still", "android");
  assert.equal(still.accuracy, "low");
  assert.equal(still.geofence, true);
  assert.ok(still.timeInterval >= 5 * MIN && still.timeInterval <= 15 * MIN);
  assert.equal(profileSpec("still", "ios").distanceInterval, 500);
  for (const profile of ["walk", "drive", "still", "low", "sos", "sosStill"]) {
    const spec = profileSpec(profile, "android");
    assert.ok(spec.deferredUpdatesInterval < spec.timeInterval, profile);
    // A still share must keep publishing before contacts see it as stale.
    assert.ok(spec.heartbeatMs < SHARE_STALE_AFTER_MS, profile);
  }
  assert.ok(profileSpec("still", "android").publishIntervalMs < SHARE_STALE_AFTER_MS);
});

const decide = (overrides = {}) =>
  publishDecision({
    fix: fix({ timestamp: T0 + 2 * MIN }),
    last: { ...HOME, accuracy: 20, timestamp: T0, ok: true },
    lastPublishedAt: T0,
    lastAttemptAt: T0,
    failures: 0,
    spec: profileSpec("walk", "android"),
    now: T0 + 2 * MIN,
    ...overrides,
  });

test("publishing skips jitter until the heartbeat", () => {
  assert.equal(decide(), "unmoved");
  assert.equal(decide({ fix: fix({ latitude: HOME.latitude + 60 * M }) }), "publish");
  // Within the wider of the two accuracies.
  assert.equal(decide({ fix: fix({ latitude: HOME.latitude + 60 * M, accuracy: 80 }) }), "unmoved");
  assert.equal(decide({ now: T0 + HEARTBEAT_MS }), "publish");
  assert.equal(decide({ last: null, lastPublishedAt: null }), "publish");
});

test("publishing keeps the profile interval and drops wide fixes", () => {
  assert.equal(decide({ fix: fix({ latitude: HOME.latitude + 500 * M }), now: T0 + 30_000 }), "tooSoon");
  assert.equal(decide({ fix: fix({ latitude: HOME.latitude + 500 * M }), now: T0 + 50_000 }), "publish");
  assert.equal(decide({ fix: fix({ accuracy: 900 }) }), "inaccurate");
});

test("failed publishes back off 1, 2, 4, then 8 minutes", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(backoffMs), [0, MIN, 2 * MIN, 4 * MIN, 8 * MIN, 8 * MIN]);
  const moved = fix({ latitude: HOME.latitude + 500 * M });
  assert.equal(decide({ fix: moved, failures: 3, lastAttemptAt: T0 + MIN, now: T0 + 4 * MIN }), "backoff");
  assert.equal(decide({ fix: moved, failures: 3, lastAttemptAt: T0 + MIN, now: T0 + 5 * MIN }), "publish");
});

test("only auth failures drop the cached token", () => {
  assert.equal(isAuthError("Not authenticated"), true);
  assert.equal(isAuthError("Unauthenticated: Could not verify OIDC token claim"), true);
  assert.equal(isAuthError("Token expired"), true);
  assert.equal(isAuthError("Network request failed"), false);
  assert.equal(isAuthError("network_error"), false);
  assert.equal(isAuthError(null), false);
});

test("battery rounds to 5 %", () => {
  assert.equal(roundBattery(0.62), 0.6);
  assert.equal(roundBattery(0.63), 0.65);
  assert.equal(roundBattery(-1), undefined);
  assert.equal(roundBattery(undefined), undefined);
});

test("next stale transition", () => {
  const shares = [{ updatedAt: T0 }, { updatedAt: T0 - 20 * MIN }, { updatedAt: T0 - 5 * MIN }];
  assert.equal(nextStaleAt(shares, T0), T0 + 10 * MIN);
  assert.equal(nextStaleAt([{ updatedAt: T0 - 20 * MIN }], T0), null);
  assert.equal(nextStaleAt([], T0), null);
});
