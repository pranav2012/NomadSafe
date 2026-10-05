import { secureStore } from "@/modules/storage";
import { elapsedSinceBootMs } from "../utils/bootClock";

const KEY = "nomadsafe.pin-attempts";
const FREE_ATTEMPTS = 5;
const READ_ERROR_LOCK_MS = 30_000;

interface AttemptState {
  failures: number;
  lockedAt: number | null;
  lockMs: number;
  bootAt: number | null;
}

const EMPTY: AttemptState = { failures: 0, lockedAt: null, lockMs: 0, bootAt: null };

// The latest state this session wrote, so a failed write or read can't reset the count.
let memory: AttemptState = EMPTY;
let readErrorUntil: number | null = null;

/** Escalating lockout: 30s after 5 failures, doubling per further failure, capped at 1h. */
function lockoutFor(failures: number) {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(30_000 * 2 ** (failures - FREE_ATTEMPTS), 60 * 60_000);
}

function parse(raw: string | null): AttemptState {
  if (!raw) return EMPTY;
  const value = JSON.parse(raw) as Partial<AttemptState> & { lockedUntil?: number | null; uptimeAt?: unknown };
  const failures = Number.isFinite(value.failures) ? Number(value.failures) : FREE_ATTEMPTS;
  if (value.lockedAt === undefined && value.lockedUntil) {
    const lockMs = lockoutFor(failures);
    return { failures, lockedAt: value.lockedUntil - lockMs, lockMs, bootAt: null };
  }
  const { uptimeAt: _uptimeAt, ...rest } = value;
  return { ...EMPTY, ...rest, failures };
}

/** Persisted state merged with this session's; null when storage can't be read. */
async function read(): Promise<AttemptState | null> {
  try {
    const stored = parse(await secureStore.get(KEY));
    return stored.failures >= memory.failures ? stored : memory;
  } catch {
    return null;
  }
}

async function write(state: AttemptState) {
  memory = state;
  try {
    await secureStore.set(KEY, JSON.stringify(state));
  } catch {}
}

/**
 * Time served on a lockout; null when the wall clock went backwards. The boot clock counts sleep and
 * can't be changed, so within one boot it catches a wall clock moved forward. After a reboot, at
 * least the time since boot has passed.
 */
function servedMs(state: AttemptState & { lockedAt: number }): number | null {
  const wallElapsed = Date.now() - state.lockedAt;
  if (wallElapsed < 0) return null;
  const boot = elapsedSinceBootMs();
  if (boot === null) return wallElapsed;
  if (state.bootAt !== null && boot >= state.bootAt) return Math.min(wallElapsed, boot - state.bootAt);
  return Math.min(wallElapsed, boot);
}

/** Without a readable count, allows one attempt per READ_ERROR_LOCK_MS. */
function readErrorStatus() {
  const now = Date.now();
  if (readErrorUntil === null || now >= readErrorUntil || now < readErrorUntil - READ_ERROR_LOCK_MS) {
    readErrorUntil = now + READ_ERROR_LOCK_MS;
    return { failures: FREE_ATTEMPTS, remainingMs: 0, attemptsLeft: 0 };
  }
  return { failures: FREE_ATTEMPTS, remainingMs: readErrorUntil - now, attemptsLeft: 0 };
}

export const pinAttempts = {
  async status() {
    const state = await read();
    if (!state) return readErrorStatus();
    let remainingMs = 0;
    if (state.lockedAt && state.lockMs > 0) {
      const served = servedMs({ ...state, lockedAt: state.lockedAt });
      if (served === null) {
        remainingMs = state.lockMs;
        await write({ ...state, lockedAt: Date.now(), bootAt: elapsedSinceBootMs() });
      } else {
        remainingMs = Math.max(0, state.lockMs - served);
        // A served lockout is cleared, so a later reboot or clock change can't bring it back.
        if (remainingMs === 0) await write({ ...state, lockedAt: null, lockMs: 0, bootAt: null });
      }
    }
    return {
      failures: state.failures,
      remainingMs,
      attemptsLeft: Math.max(0, FREE_ATTEMPTS - state.failures),
    };
  },

  async recordFailure() {
    const state = (await read()) ?? { ...memory, failures: Math.max(memory.failures, FREE_ATTEMPTS - 1) };
    const failures = state.failures + 1;
    const lockMs = lockoutFor(failures);
    await write({ failures, lockedAt: lockMs ? Date.now() : null, lockMs, bootAt: lockMs ? elapsedSinceBootMs() : null });
    return { failures, lockMs, attemptsLeft: Math.max(0, FREE_ATTEMPTS - failures) };
  },

  async reset() {
    memory = EMPTY;
    readErrorUntil = null;
    try {
      await secureStore.remove(KEY);
    } catch {}
  },
};
