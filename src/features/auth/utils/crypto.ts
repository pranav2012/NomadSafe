import * as Crypto from "expo-crypto";

const LEGACY_SALT = "nomadsafe-salt";
const VERSION = "v2";

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

/** Returns `v2$<salt>$<hash>` using a random per-install salt. */
export async function hashPin(pin: string): Promise<string> {
  const salt = toHex(Crypto.getRandomBytes(16));
  return `${VERSION}$${salt}$${await sha256(`${salt}:${pin}`)}`;
}

/** Verifies both the v2 format and the legacy fixed-salt hash. */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length === 3 && parts[0] === VERSION) {
    return (await sha256(`${parts[1]}:${pin}`)) === parts[2];
  }
  return (await sha256(pin + LEGACY_SALT)) === storedHash;
}

export function isLegacyPinHash(storedHash: string) {
  return !storedHash.startsWith(`${VERSION}$`);
}
