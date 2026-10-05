import { hashPin, needsRehash, verifyPin } from "../utils/crypto";
import { pinAttempts } from "./pinAttempts";
import { secureStorage } from "./secureStorage";

export type PinCheck =
  | { status: "ok" }
  | { status: "wrong"; attemptsLeft: number; lockMs: number }
  | { status: "locked"; remainingMs: number }
  | { status: "missing" };

const REHASH_DELAY_MS = 1_500;

/**
 * Checks a PIN against the stored hash under the shared attempt lockout. On success, a hash in an
 * older or weaker format is replaced shortly after, so the unlock itself isn't slowed down.
 */
export async function checkPin(pin: string): Promise<PinCheck> {
  const lock = await pinAttempts.status();
  if (lock.remainingMs > 0) return { status: "locked", remainingMs: lock.remainingMs };
  const storedHash = await secureStorage.getPin();
  if (!storedHash) return { status: "missing" };
  if (await verifyPin(pin, storedHash)) {
    await pinAttempts.reset();
    if (needsRehash(storedHash)) {
      setTimeout(() => {
        void (async () => {
          const upgraded = await hashPin(pin);
          if ((await secureStorage.getPin()) === storedHash) await secureStorage.setPin(upgraded);
        })().catch(() => {});
      }, REHASH_DELAY_MS);
    }
    return { status: "ok" };
  }
  const result = await pinAttempts.recordFailure();
  return { status: "wrong", attemptsLeft: result.attemptsLeft, lockMs: result.lockMs };
}
