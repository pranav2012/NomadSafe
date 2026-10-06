/**
 * The one place that decides which AI answers each task; the router and `useAiAvailability` read only
 * from here. Kept free of React Native imports so it can be unit tested.
 */

/** byok = the user's own API key (direct from the phone); cloud = NomadSafe Cloud (Pro, via Convex); local = llama.rn on the phone. */
export type AiProvider = "byok" | "cloud" | "local";
export type RemoteProvider = Exclude<AiProvider, "local">;

export type AiTask = "chat" | "chatSummary" | "tripBudget" | "tripName" | "itinerary" | "voiceExpense" | "expenseCategory";

const ONLINE_FIRST = ["byok", "cloud", "local"] as const satisfies readonly AiProvider[];

/**
 * Providers tried in order per task. One that isn't set up, is offline, or fails falls through to
 * the next; leaving a provider out means the task never uses it.
 */
export const AI_TASK_ROUTES: Record<AiTask, readonly AiProvider[]> = {
  chat: ONLINE_FIRST,
  // "local" keeps the existing summary; the phone model compacts in its own chat path.
  chatSummary: ONLINE_FIRST,
  tripBudget: ONLINE_FIRST,
  tripName: ONLINE_FIRST,
  // Refine only cleans up Gmail imports (never what the user added), and Gmail text must stay on the phone.
  itinerary: ["local"],
  // Only the transcript text goes online, never audio.
  voiceExpense: ONLINE_FIRST,
  // Imports carry raw Gmail/SMS text, which must never leave the device (Google Limited Use).
  expenseCategory: ["local"],
};

/** Monthly NomadSafe Cloud allowance a task draws from (`CLOUD_AI_LIMITS` in convex/billingRules.ts). */
export type CloudQuota = "chat" | "tasks";

export function cloudQuotaFor(task: AiTask): CloudQuota {
  return task === "chat" ? "chat" : "tasks";
}

export interface OnlineAiState {
  onlineAiEnabled: boolean;
  hasByokKey: boolean;
  cloudAi: boolean;
  signedIn: boolean;
  cloudExhausted: boolean;
  /** The source the user picked for every AI feature; null/undefined = automatic (route order). */
  preferred?: AiProvider | null;
  /** On-device AI is on and a model is downloaded; an on-device preference only counts when it is. */
  localReady?: boolean;
}

function remoteUsable(provider: RemoteProvider, state: OnlineAiState): boolean {
  if (!state.onlineAiEnabled) return false;
  if (provider === "byok") return state.hasByokKey;
  return state.cloudAi && state.signedIn && !state.cloudExhausted;
}

/**
 * The user's preferred source if it can answer `task` right now (connectivity aside), else null.
 * A source that's off, not set up or not on the task's route (e.g. online for `expenseCategory`)
 * is ignored rather than cleared, so the choice comes back when the source does.
 */
export function effectivePreference(task: AiTask, state: OnlineAiState): AiProvider | null {
  const preferred = state.preferred ?? null;
  if (preferred === null || !AI_TASK_ROUTES[task].includes(preferred)) return null;
  if (preferred === "local") return state.localReady ? "local" : null;
  return remoteUsable(preferred, state) ? preferred : null;
}

/**
 * Providers for `task` in the order they're tried. The effective preference moves to the front and
 * the rest keep route order, so a failing online pick falls back to the other online source, then
 * the phone. An on-device pick with a model ready means on-device only (nothing goes online); with
 * no model ready it is ignored and the automatic order applies, so the user isn't left without AI.
 */
export function providerOrder(task: AiTask, state: OnlineAiState): AiProvider[] {
  const route = AI_TASK_ROUTES[task];
  const pick = effectivePreference(task, state);
  if (pick === "local") return ["local"];
  if (pick === null) return [...route];
  return [pick, ...route.filter((p) => p !== pick)];
}

/**
 * Online providers allowed and set up for `task`, in try order (connectivity is checked by the caller).
 * Needs Settings → Online AI on; cloud also needs Pro, sign-in and monthly quota left.
 */
export function onlineProvidersFor(task: AiTask, state: OnlineAiState): RemoteProvider[] {
  if (!state.onlineAiEnabled) return [];
  return providerOrder(task, state).filter((p): p is RemoteProvider => p !== "local" && remoteUsable(p, state));
}

export function allowsLocal(task: AiTask): boolean {
  return AI_TASK_ROUTES[task].includes("local");
}

// Online models have far larger windows; this only bounds what a long chat sends each turn.
export const REMOTE_CONTEXT_TOKENS = 24_000;
// The cloud endpoint accepts at most 60 messages, including the system prompt.
export const REMOTE_MAX_TURNS = 40;
// Recent turns kept when online chat compaction fails.
export const REMOTE_RECENT_TURNS_FALLBACK = 12;

export const REMOTE_JSON_MAX_TOKENS = 2048;
export const REMOTE_CHAT_MAX_TOKENS = 4096;

export const REMOTE_JSON_TIMEOUT_MS = 30_000;
// A streamed reply must start within this; once tokens flow it may take longer.
export const REMOTE_FIRST_CHUNK_TIMEOUT_MS = 30_000;
export const REMOTE_STREAM_TIMEOUT_MS = 120_000;

// Label only: NomadSafe Cloud calls OpenRouter from convex/ai.ts, and the CLOUD_AI_MODEL Convex env var picks the model.
export const CLOUD_MODEL = "openai/gpt-6-luna";

export type ByokProvider = "openai" | "anthropic" | "gemini" | "openai_compatible";

export const BYOK_PROVIDER_DEFAULTS: Record<ByokProvider, { model: string; suggestions: string[] }> = {
  openai: { model: "gpt-6-luna", suggestions: ["gpt-6-luna", "gpt-6-sol"] },
  anthropic: { model: "claude-opus-5-5", suggestions: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"] },
  gemini: { model: "gemini-3.8-flash", suggestions: ["gemini-3.8-flash"] },
  openai_compatible: { model: "", suggestions: [] },
};
