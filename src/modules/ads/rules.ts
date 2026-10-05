export type AdPlacement =
  | "trip_created"
  | "expenses_imported"
  | "expense_saved"
  | "settlement_recorded"
  | "itinerary_refined"
  | "itinerary_event_added"
  | "ai_chat_exit";

export interface AdConfig {
  /** No ads until the install is `graceHours` old and past `graceSessions` sessions. */
  graceHours: number;
  graceSessions: number;
  gapSeconds: number;
  sessionDelaySeconds: number;
  perSession: number;
  perDay: number;
  /** Show on every Nth qualifying action per placement; 0 turns the placement off. */
  every: Record<AdPlacement, number>;
}

export const DEFAULT_AD_CONFIG: AdConfig = {
  graceHours: 24,
  graceSessions: 2,
  gapSeconds: 180,
  sessionDelaySeconds: 60,
  perSession: 2,
  perDay: 6,
  every: {
    trip_created: 1,
    expenses_imported: 1,
    expense_saved: 4,
    settlement_recorded: 1,
    itinerary_refined: 1,
    itinerary_event_added: 3,
    ai_chat_exit: 1,
  },
};

/** A new session starts on launch or after this long in the background. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const count = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

/** Merges a remote (PostHog flag payload) override onto the defaults, ignoring invalid fields. */
export function resolveAdConfig(remote: unknown): AdConfig {
  if (!remote || typeof remote !== "object") return DEFAULT_AD_CONFIG;
  const r = remote as Partial<Record<keyof AdConfig, unknown>>;
  const every = (r.every && typeof r.every === "object" ? r.every : {}) as Record<string, unknown>;
  const d = DEFAULT_AD_CONFIG;
  return {
    graceHours: count(r.graceHours, d.graceHours),
    graceSessions: count(r.graceSessions, d.graceSessions),
    gapSeconds: count(r.gapSeconds, d.gapSeconds),
    sessionDelaySeconds: count(r.sessionDelaySeconds, d.sessionDelaySeconds),
    perSession: count(r.perSession, d.perSession),
    perDay: count(r.perDay, d.perDay),
    every: Object.fromEntries(
      (Object.keys(d.every) as AdPlacement[]).map((key) => [key, count(every[key], d.every[key])]),
    ) as Record<AdPlacement, number>,
  };
}

export interface AdCheck {
  now: number;
  config: AdConfig;
  installedAt: number;
  sessions: number;
  sessionStartedAt: number;
  shownThisSession: number;
  recentShows: number[];
  loaded: boolean;
}

/** Shared frequency rules for every interstitial placement. */
export function canShowAd({ now, config, installedAt, sessions, sessionStartedAt, shownThisSession, recentShows, loaded }: AdCheck): boolean {
  if (!loaded) return false;
  if (now - installedAt < config.graceHours * 3600_000 || sessions <= config.graceSessions) return false;
  if (now - sessionStartedAt < config.sessionDelaySeconds * 1000) return false;
  if (shownThisSession >= config.perSession) return false;
  const lastShown = recentShows.at(-1);
  if (lastShown !== undefined && now - lastShown < config.gapSeconds * 1000) return false;
  return recentShows.filter((at) => now - at < DAY_MS).length < config.perDay;
}

/** Whether a placement's action count has reached its "every Nth" threshold. */
export function placementDue(actions: number, every: number): boolean {
  return every > 0 && actions >= every;
}

/** Keeps only the shows that still count towards the daily cap. */
export function pruneShows(shows: number[], now: number): number[] {
  return shows.filter((at) => now - at < DAY_MS);
}
