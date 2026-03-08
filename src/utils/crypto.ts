import * as Crypto from "expo-crypto";

export async function hashPin(pin: string): Promise<string> {
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    pin + "nomadsafe-salt",
  );
}

export async function verifyPin(
  pin: string,
  storedHash: string,
): Promise<boolean> {
  const hash = await hashPin(pin);
  return hash === storedHash;
}
