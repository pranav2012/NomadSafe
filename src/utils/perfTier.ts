export type PerfTier = "high" | "mid" | "low";

export type PerfSignals = {
  os: "ios" | "android" | "other";
  /** OS-reported total RAM in bytes (always a bit under the marketed size). */
  totalMemory: number | null;
  apiLevel: number | null;
  yearClass: number | null;
  lowPower: boolean;
  /** Tiers dropped by the frame-time governor this session. */
  governorDrops: number;
};

const TIERS: PerfTier[] = ["high", "mid", "low"];
const GB = 1024 ** 3;

/** Marketed RAM in GB, rounded up from the OS total; 0 when unknown. */
export function ramGb(totalMemory: number | null): number {
  if (typeof totalMemory !== "number" || !Number.isFinite(totalMemory) || totalMemory <= 0) return 0;
  return Math.ceil(totalMemory / GB - 0.05);
}

/** The phone's tier before low power mode and the governor. */
export function hardwareTier(s: Pick<PerfSignals, "os" | "totalMemory" | "apiLevel" | "yearClass">): PerfTier {
  const ram = ramGb(s.totalMemory);
  if (s.os === "ios") {
    if (ram === 0 || ram >= 4) return "high";
    return ram >= 3 ? "mid" : "low";
  }
  if (s.os !== "android") return "high";
  if (s.apiLevel != null && s.apiLevel <= 29) return "low";
  if (ram !== 0 && ram <= 4) return "low";
  // Facebook's YearClass tops out at 2016, so it only flags truly old phones.
  if (s.yearClass != null && s.yearClass < 2014) return "low";
  return ram !== 0 && ram < 8 ? "mid" : "high";
}

export function computePerfTier(s: PerfSignals): PerfTier {
  if (s.lowPower) return "low";
  const index = TIERS.indexOf(hardwareTier(s)) + Math.max(0, s.governorDrops);
  return TIERS[Math.min(index, TIERS.length - 1)];
}

export const GOVERNOR_SLOW_FRAME_MS = 20;
export const GOVERNOR_MIN_FRAMES = 30;

/** True when the median frame of a sample window took over 20 ms (more than half the frames were slow). */
export function shouldDropTier(slowFrames: number, totalFrames: number): boolean {
  return totalFrames >= GOVERNOR_MIN_FRAMES && slowFrames * 2 > totalFrames;
}
