import { secureStore } from "@/modules/storage";

const KEY = "nomadsafe.pin-attempts";
const FREE_ATTEMPTS = 5;

interface AttemptState {
  failures: number;
  lockedUntil: number | null;
}

const EMPTY: AttemptState = { failures: 0, lockedUntil: null };

/** Escalating lockout: 30s after 5 failures, doubling per further failure, capped at 1h. */
function lockoutFor(failures: number) {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(30_000 * 2 ** (failures - FREE_ATTEMPTS), 60 * 60_000);
}

async function read(): Promise<AttemptState> {
  try {
    const raw = await secureStore.get(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as AttemptState) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

async function write(state: AttemptState) {
  try {
    await secureStore.set(KEY, JSON.stringify(state));
  } catch {}
}

export const pinAttempts = {
  async status() {
    const state = await read();
    const remainingMs = state.lockedUntil ? Math.max(0, state.lockedUntil - Date.now()) : 0;
    return {
      failures: state.failures,
      remainingMs,
      attemptsLeft: Math.max(0, FREE_ATTEMPTS - state.failures),
    };
  },

  async recordFailure() {
    const state = await read();
    const failures = state.failures + 1;
    const lockMs = lockoutFor(failures);
    await write({ failures, lockedUntil: lockMs ? Date.now() + lockMs : null });
    return { failures, lockMs, attemptsLeft: Math.max(0, FREE_ATTEMPTS - failures) };
  },

  async reset() {
    try {
      await secureStore.remove(KEY);
    } catch {}
  },
};
