/** Pure rules for the on-phone log of online AI uses (feature, provider, time; never content). */
import type { AiTask, RemoteProvider } from "./policy";

export interface AiUsageEntry {
  task: AiTask;
  provider: RemoteProvider;
  at: number;
}

export type AiTaskCounts = Partial<Record<AiTask, number>>;

export const USAGE_LOG_MAX_ENTRIES = 200;

function sameLocalMonth(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth();
}

/** Entries from the calendar month of `now` (phone time zone), oldest first. */
export function currentMonthEntries(entries: readonly AiUsageEntry[], now: number): AiUsageEntry[] {
  return entries.filter((entry) => sameLocalMonth(entry.at, now));
}

/** Adds `entry`, drops earlier months and keeps only the newest `USAGE_LOG_MAX_ENTRIES`. */
export function appendUsage(entries: readonly AiUsageEntry[], entry: AiUsageEntry): AiUsageEntry[] {
  return [...currentMonthEntries(entries, entry.at), entry].slice(-USAGE_LOG_MAX_ENTRIES);
}

export function countByTask(entries: readonly AiUsageEntry[], provider: RemoteProvider): AiTaskCounts {
  const counts: AiTaskCounts = {};
  for (const entry of entries) {
    if (entry.provider === provider) counts[entry.task] = (counts[entry.task] ?? 0) + 1;
  }
  return counts;
}

export interface AiUsageSummary {
  /** Newest first. */
  recent: AiUsageEntry[];
  byokCountsByTask: AiTaskCounts;
  /** NomadSafe Cloud uses seen by this phone; the server's `myUsage` is the real count. */
  cloudCountsByTask: AiTaskCounts;
  byokTotal: number;
}

export function summarizeUsage(entries: readonly AiUsageEntry[], now: number, recentLimit = 20): AiUsageSummary {
  const month = currentMonthEntries(entries, now);
  return {
    recent: month.slice(-recentLimit).reverse(),
    byokCountsByTask: countByTask(month, "byok"),
    cloudCountsByTask: countByTask(month, "cloud"),
    byokTotal: month.filter((entry) => entry.provider === "byok").length,
  };
}
