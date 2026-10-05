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
  INVITE_CODE_ALPHABET,
  clampClientTime,
  constantTimeEqual,
  isExpoPushToken,
  isValidCoordinate,
  newInviteCode,
  normalizeInviteCode,
} = loadModule("convex/securityRules.ts");

test("constant-time compare matches only identical strings", () => {
  assert.equal(constantTimeEqual("Bearer abc", "Bearer abc"), true);
  assert.equal(constantTimeEqual("Bearer abc", "Bearer abd"), false);
  assert.equal(constantTimeEqual("Bearer abc", "Bearer ab"), false);
  assert.equal(constantTimeEqual("", ""), true);
  assert.equal(constantTimeEqual("é", "e"), false);
});

test("invite codes are 10 characters from the alphabet", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = newInviteCode();
    assert.equal(code.length, 10);
    for (const char of code) assert.ok(INVITE_CODE_ALPHABET.includes(char));
  }
});

test("invite code generation rejects bytes that would bias the alphabet", () => {
  // With 3 letters, bytes 0-254 map evenly; 255 would favour "A" and must be skipped.
  const bytes = [255, 0, 254, 1, 253, 2, 252, 3];
  const code = newInviteCode(4, "ABC", (buffer) => {
    buffer.set(bytes.slice(0, buffer.length));
    return buffer;
  });
  assert.equal(code, "ACBB");
});

test("invite code normalisation accepts old 8- and new 10-character codes only", () => {
  assert.equal(normalizeInviteCode(" ab12cd34 "), "AB12CD34");
  assert.equal(normalizeInviteCode("AB12CD34EF"), "AB12CD34EF");
  assert.equal(normalizeInviteCode("AB12"), null);
  assert.equal(normalizeInviteCode("AB12-CD34"), null);
  assert.equal(normalizeInviteCode("A".repeat(17)), null);
});

test("push tokens must look like Expo tokens", () => {
  assert.equal(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"), true);
  assert.equal(isExpoPushToken("ExpoPushToken[abc_DEF-123]"), true);
  assert.equal(isExpoPushToken("ExponentPushToken[]"), false);
  assert.equal(isExpoPushToken("ExponentPushToken[abc] "), false);
  assert.equal(isExpoPushToken("fcm:abc"), false);
  assert.equal(isExpoPushToken(`ExponentPushToken[${"a".repeat(300)}]`), false);
});

test("client timestamps are capped a few minutes ahead and must be finite", () => {
  const now = 1_000_000_000_000;
  assert.equal(clampClientTime(now - 10, now), now - 10);
  assert.equal(clampClientTime(now + 60 * 60_000, now), now + 5 * 60_000);
  assert.throws(() => clampClientTime(Number.NaN, now));
  assert.throws(() => clampClientTime(Number.POSITIVE_INFINITY, now));
});

test("coordinates must be on the globe", () => {
  assert.equal(isValidCoordinate(48.85, 2.35), true);
  assert.equal(isValidCoordinate(-90, 180), true);
  assert.equal(isValidCoordinate(91, 0), false);
  assert.equal(isValidCoordinate(0, -181), false);
  assert.equal(isValidCoordinate(Number.NaN, 0), false);
});
