export type HealthAvailability = "available" | "unsupported" | "needs_update";

export interface WalkingTotals {
  steps: number;
  km: number;
  /** True when the distance is worked out from steps because no distance was recorded. */
  estimated: boolean;
}

export interface DaySteps {
  /** Local day, "YYYY-MM-DD". */
  date: string;
  steps: number;
}

export interface HealthApi {
  /** "Health Connect" or "Apple Health"; null where there is none. */
  source: "health_connect" | "apple_health" | null;
  availability(): Promise<HealthAvailability>;
  /** Shows the system permission screen for steps and walking distance (read only). */
  requestAccess(): Promise<boolean>;
  /** Steps and walking distance between two instants; null when nothing could be read. */
  readWalking(start: Date, end: Date): Promise<WalkingTotals | null>;
  /** Steps per local day between two local midnights; days without steps are left out. Null when nothing could be read. */
  readDailySteps(start: Date, end: Date): Promise<DaySteps[] | null>;
  /** Android 13 and older: opens the Play Store to install or update Health Connect. */
  openInstall(): void;
}

/** About 0.76 m a step, the usual average stride, for phones that record steps but no distance. */
export const STRIDE_KM = 0.00076;
