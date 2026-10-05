import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);

const stubs = {
  "expo-crypto": {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: async (_alg, value) => createHash("sha256").update(value).digest("hex"),
    getRandomBytes: (n) => new Uint8Array(randomBytes(n)),
  },
  "expo-modules-core": { requireOptionalNativeModule: () => ({ getElapsedSinceBootMs: () => boot }) },
  "@/modules/storage": {
    secureStore: {
      get: async (k) => {
        if (secureFails) throw new Error("keychain");
        return secure.get(k) ?? null;
      },
      set: async (k, v) => {
        if (secureFails) throw new Error("keychain");
        secure.set(k, v);
      },
      remove: async (k) => secure.delete(k),
    },
  },
};

function loadModule(entryPoint) {
  const output = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    external: Object.keys(stubs),
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("exports", "module", "require", output)(module.exports, module, (id) => stubs[id] ?? require(id));
  return module.exports;
}

const secure = new Map();
let secureFails = false;
let boot = 1_000_000;

const { hashPin, verifyPin, needsRehash } = loadModule("src/features/auth/utils/crypto.ts");
const { pinAttempts } = loadModule("src/features/auth/services/pinAttempts.ts");

test("PIN hashes use PBKDF2 and verify only the right PIN", async () => {
  const hash = await hashPin("123456");
  assert.match(hash, /^v3\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(await verifyPin("123456", hash), true);
  assert.equal(await verifyPin("123457", hash), false);
  assert.equal(needsRehash(hash), false);
});

test("older hashes still verify and are flagged for rehashing", async () => {
  const salt = randomBytes(16).toString("hex");
  const v2 = `v2$${salt}$${createHash("sha256").update(`${salt}:246810`).digest("hex")}`;
  const legacy = createHash("sha256").update("246810nomadsafe-salt").digest("hex");
  assert.equal(await verifyPin("246810", v2), true);
  assert.equal(await verifyPin("246810", legacy), true);
  assert.equal(await verifyPin("000000", v2), false);
  assert.equal(needsRehash(v2), true);
  assert.equal(needsRehash(legacy), true);
});

async function failTimes(n) {
  for (let i = 0; i < n; i++) await pinAttempts.recordFailure();
}

test("lockout survives the wall clock moving forward", async (t) => {
  await pinAttempts.reset();
  await failTimes(5);
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() + 24 * 3600_000;
  const status = await pinAttempts.status();
  assert.ok(status.remainingMs > 25_000, `remaining ${status.remainingMs}`);
});

test("lockout restarts when the wall clock moves backwards", async (t) => {
  await pinAttempts.reset();
  await failTimes(5);
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() - 3600_000;
  assert.equal((await pinAttempts.status()).remainingMs, 30_000);
});

test("lockout ends once both clocks agree it has passed", async (t) => {
  await pinAttempts.reset();
  await failTimes(5);
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  Date.now = () => realNow() + 31_000;
  boot += 31_000;
  assert.equal((await pinAttempts.status()).remainingMs, 0);
});

test("a lockout keeps counting while the phone sleeps", async (t) => {
  await pinAttempts.reset();
  await failTimes(5);
  const realNow = Date.now;
  t.after(() => (Date.now = realNow));
  // The boot clock includes sleep, so both clocks advance together.
  Date.now = () => realNow() + 3600_000;
  boot += 3600_000;
  assert.equal((await pinAttempts.status()).remainingMs, 0);
});

test("after a reboot, the time since boot counts", async (t) => {
  await pinAttempts.reset();
  await failTimes(5);
  const realNow = Date.now;
  const before = boot;
  t.after(() => {
    Date.now = realNow;
    boot = before + 3600_000;
  });
  Date.now = () => realNow() + 24 * 3600_000;
  boot = 10_000;
  assert.equal((await pinAttempts.status()).remainingMs, 20_000);
  boot = 31_000;
  assert.equal((await pinAttempts.status()).remainingMs, 0);
});

test("a served lockout doesn't come back after a reboot", async (t) => {
  await pinAttempts.reset();
  await failTimes(5);
  const realNow = Date.now;
  const before = boot;
  t.after(() => {
    Date.now = realNow;
    boot = before + 3600_000;
  });
  Date.now = () => realNow() + 31_000;
  boot += 31_000;
  assert.equal((await pinAttempts.status()).remainingMs, 0);
  boot = 1_000;
  assert.equal((await pinAttempts.status()).remainingMs, 0);
});

test("an unreadable attempt store fails closed", async (t) => {
  await pinAttempts.reset();
  secureFails = true;
  t.after(() => (secureFails = false));
  const first = await pinAttempts.status();
  assert.equal(first.attemptsLeft, 0);
  const second = await pinAttempts.status();
  assert.ok(second.remainingMs > 0);
  const failure = await pinAttempts.recordFailure();
  assert.ok(failure.lockMs > 0);
});
