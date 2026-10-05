import * as Crypto from "expo-crypto";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 as sha256Hash } from "@noble/hashes/sha2.js";

const LEGACY_SALT = "nomadsafe-salt";
const SALTED_SHA256 = "v2";
const KDF = "v3";
// Pure-JS PBKDF2 on Hermes costs roughly 0.1 ms per iteration on a mid-range phone; this keeps an
// unlock around a second. The count is stored in each hash, so it can be raised later.
export const PIN_KDF_ITERATIONS = 10_000;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

async function derive(pin: string, salt: string, iterations: number) {
  return toHex(await pbkdf2Async(sha256Hash, pin, salt, { c: iterations, dkLen: 32, asyncTick: 20 }));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns `v3$<iterations>$<salt>$<hash>`: PBKDF2-HMAC-SHA256 with a random salt. */
export async function hashPin(pin: string): Promise<string> {
  const salt = toHex(Crypto.getRandomBytes(16));
  return `${KDF}$${PIN_KDF_ITERATIONS}$${salt}$${await derive(pin, salt, PIN_KDF_ITERATIONS)}`;
}

/** Verifies the PBKDF2 format and the older salted / fixed-salt SHA-256 hashes. */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length === 4 && parts[0] === KDF) {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1) return false;
    return constantTimeEqual(await derive(pin, parts[2], iterations), parts[3]);
  }
  if (parts.length === 3 && parts[0] === SALTED_SHA256) {
    return constantTimeEqual(await sha256(`${parts[1]}:${pin}`), parts[2]);
  }
  return constantTimeEqual(await sha256(pin + LEGACY_SALT), storedHash);
}

/** True when a hash should be replaced after the next successful unlock. */
export function needsRehash(storedHash: string) {
  const parts = storedHash.split("$");
  return parts.length !== 4 || parts[0] !== KDF || Number(parts[1]) < PIN_KDF_ITERATIONS;
}
