export const ENTITLEMENT_IDS = {
  unlimitedTrips: "unlimited_trips",
  cloudAi: "cloud_ai",
} as const;

export const CLOUD_AI_LIMITS = { chat: 300, tasks: 1500 } as const;

export type CloudAiKind = keyof typeof CLOUD_AI_LIMITS;

export interface PlanSnapshot {
  unlimitedTrips: boolean;
  cloudAi: boolean;
  expiresAt?: number;
  productId?: string;
}

interface RevenueCatEntitlement {
  expires_date?: string | null;
  grace_period_expires_date?: string | null;
  product_identifier?: string;
}

/** Latest time an entitlement stays usable (grace period included); null means it never expires. */
function entitlementEnd(entitlement: RevenueCatEntitlement): number | null {
  if (!entitlement.expires_date) return null;
  const ends = [entitlement.expires_date, entitlement.grace_period_expires_date]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter(Number.isFinite);
  return ends.length ? Math.max(...ends) : 0;
}

/**
 * Reads the active entitlements from a RevenueCat v1 `GET /subscribers/{id}` body. Pro implies
 * unlimited trips even if the dashboard only attaches `cloud_ai` to the product.
 */
export function planFromSubscriber(body: unknown, now: number): PlanSnapshot {
  const entitlements =
    ((body as { subscriber?: { entitlements?: Record<string, RevenueCatEntitlement> } })?.subscriber?.entitlements) ?? {};
  const active = (id: string) => {
    const entitlement = entitlements[id];
    if (!entitlement) return null;
    const end = entitlementEnd(entitlement);
    return end === null || end > now ? { end, productId: entitlement.product_identifier } : null;
  };

  const trips = active(ENTITLEMENT_IDS.unlimitedTrips);
  const ai = active(ENTITLEMENT_IDS.cloudAi);
  const ends = [trips, ai].filter((entry) => entry !== null).map((entry) => entry.end);
  const expiresAt = ends.length === 0 || ends.includes(null) ? undefined : Math.max(...(ends as number[]));

  return {
    unlimitedTrips: trips !== null || ai !== null,
    cloudAi: ai !== null,
    expiresAt,
    productId: ai?.productId ?? trips?.productId,
  };
}

/** Whether a stored plan still grants cloud AI at `now` (covers a missed expiration webhook). */
export function hasActiveCloudAi(plan: PlanSnapshot | null, now: number): boolean {
  if (!plan?.cloudAi) return false;
  return plan.expiresAt === undefined || plan.expiresAt > now;
}

/** The better of a purchased plan and a granted one at `now`; each counts only while unexpired. */
export function effectivePlan(
  purchased: PlanSnapshot | null,
  granted: PlanSnapshot | null,
  now: number,
): { unlimitedTrips: boolean; cloudAi: boolean } {
  const live = (plan: PlanSnapshot | null) => (plan && (plan.expiresAt === undefined || plan.expiresAt > now) ? plan : null);
  const grant = live(granted);
  return {
    unlimitedTrips: (purchased?.unlimitedTrips ?? false) || (grant?.unlimitedTrips ?? false) || (grant?.cloudAi ?? false),
    cloudAi: hasActiveCloudAi(purchased, now) || (grant?.cloudAi ?? false),
  };
}

/** True when the `BETA_PLAN` env var gives every signed-in user Plus (beta testing). */
export function isBetaPlus(betaPlan: string | undefined): boolean {
  return betaPlan?.trim().toLowerCase() === "plus";
}

export function usageMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function remainingQuota(used: number, kind: CloudAiKind): number {
  return Math.max(0, CLOUD_AI_LIMITS[kind] - used);
}

/** Features that may use NomadSafe Cloud; must match the online tasks in src/modules/ai/policy.ts. */
export const CLOUD_AI_TASKS = ["chat", "chatSummary", "tripBudget", "tripName", "voiceExpense", "receiptItems"] as const;

export type CloudAiTask = (typeof CLOUD_AI_TASKS)[number];

export type CloudAiTaskCounts = Partial<Record<CloudAiTask, number>>;

export function isCloudAiTask(value: unknown): value is CloudAiTask {
  return typeof value === "string" && (CLOUD_AI_TASKS as readonly string[]).includes(value);
}

/** The monthly allowance a feature draws from: chat replies, or everything else. */
export function quotaKindFor(task: CloudAiTask): CloudAiKind {
  return task === "chat" ? "chat" : "tasks";
}

/** Per-feature counts with `task` moved by `delta`, never below zero. */
export function adjustTaskCount(counts: CloudAiTaskCounts | undefined, task: CloudAiTask, delta: number): CloudAiTaskCounts {
  return { ...counts, [task]: Math.max(0, (counts?.[task] ?? 0) + delta) };
}

/** Every feature's count for the month, zero when unused. */
export function fullTaskCounts(counts: CloudAiTaskCounts | undefined): Record<CloudAiTask, number> {
  return Object.fromEntries(CLOUD_AI_TASKS.map((task) => [task, counts?.[task] ?? 0])) as Record<CloudAiTask, number>;
}

/** When the monthly allowance resets: the first of next month, 00:00 UTC. */
export function usageResetsAt(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}
