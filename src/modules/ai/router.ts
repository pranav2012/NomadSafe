import * as Network from "expo-network";
import { useAuthStore } from "@/features/auth/store/authStore";
import { usePlanStore } from "@/modules/billing";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { VOICE_EXTRACTION_SYSTEM_PROMPT, voiceExtractionRequest } from "@/features/expenses/services/voiceExpense";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";
import {
  REMOTE_CONTEXT_TOKENS,
  REMOTE_MAX_TURNS,
  REMOTE_RECENT_TURNS_FALLBACK,
  cloudQuotaFor,
  onlineProvidersFor,
  providerOrder,
  type AiProvider,
  type AiTask,
  type OnlineAiState,
} from "./policy";
import { AI_TASKS, type JsonTask } from "./schemas";
import {
  AI_PROMPTS,
  chatSystemContent,
  parseBudgetEstimate,
  parseExpenseCategory,
  parseItineraryRefinement,
  parseTripName,
  parseVoiceExtraction,
  refinementEvents,
  type ChatMemory,
  type ChatOptions,
  type ChatTurn,
  type ExpenseCategoryId,
  type ExpenseCategoryInput,
  type ItineraryEventRefinement,
  type ItineraryEventRefinementInput,
  type TripBudgetEstimate,
  type TripBudgetEstimateInput,
  type TripNameInput,
  type TripNameSuggestion,
  parseReceiptItems,
  RECEIPT_ITEMS_SYSTEM_PROMPT,
  receiptItemsRequest,
  type ReceiptItems,
} from "./prompts";
import { compactChatMemory } from "./chatMemory";
import { localModelService } from "./local/localModelService";
import { useProvisioningStore } from "./local/modelProvisioner";
import { useAiPreferenceStore } from "./preference";
import { recordAiUsage } from "./usageLog";
import { byokChat, byokCompleteJson, getByokConfig } from "./remote/byok";
import { cloudChat, cloudCompleteJson, isCloudExhausted } from "./remote/cloud";
import type { ByokConfig, RemoteMessage } from "./remote/providers";

type Route = { kind: "byok"; config: ByokConfig } | { kind: "cloud" } | { kind: "local" };
type RemoteRoute = Exclude<Route, { kind: "local" }>;
type TrackedTask = "chat" | "budget" | "trip_name" | "itinerary" | "voice" | "receipt";

const TRACKED_TASKS: Partial<Record<AiTask, TrackedTask>> = {
  chat: "chat",
  tripBudget: "budget",
  tripName: "trip_name",
  itinerary: "itinerary",
  voiceExpense: "voice",
  receiptItems: "receipt",
};

let chatAbort: AbortController | null = null;

function onlineState(task: AiTask, byok: ByokConfig | null, localReady: boolean): OnlineAiState {
  return {
    onlineAiEnabled: useSettingsStore.getState().onlineAiEnabled,
    hasByokKey: byok !== null,
    cloudAi: usePlanStore.getState().cloudAi,
    signedIn: useAuthStore.getState().isSignedIn,
    cloudExhausted: isCloudExhausted(cloudQuotaFor(task)),
    preferred: useAiPreferenceStore.getState().preferred,
    localReady,
  };
}

function localReadyNow(): boolean {
  return useSettingsStore.getState().localAiEnabled && useProvisioningStore.getState().activeModelId !== null;
}

/** Whether a request for `task` could go online at all (ignoring connectivity and quota), for callers that trim what they send. */
export function mayUseOnlineAi(task: AiTask = "chat"): boolean {
  if (!useSettingsStore.getState().onlineAiEnabled) return false;
  return onlineProvidersFor(task, { ...onlineState(task, getByokConfig(), localReadyNow()), cloudExhausted: false }).length > 0;
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch {
    return false;
  }
}

/**
 * The task's providers that can run right now, in policy order (the user's pick first); online ones
 * drop out when offline or not set up.
 */
async function routesFor(task: AiTask): Promise<Route[]> {
  const byok = useSettingsStore.getState().onlineAiEnabled ? getByokConfig() : null;
  // The file check only matters for an on-device pick, which then rules out online providers.
  const localReady = useAiPreferenceStore.getState().preferred === "local" && (await localModelService.getReadyModel()) !== null;
  const state = onlineState(task, byok, localReady);
  let online = onlineProvidersFor(task, state);
  if (online.length > 0 && !(await isOnline())) online = [];
  return providerOrder(task, state).flatMap((provider): Route[] => {
    if (provider === "local") return [{ kind: "local" }];
    if (!online.includes(provider)) return [];
    if (provider === "cloud") return [{ kind: "cloud" }];
    return byok ? [{ kind: "byok", config: byok }] : [];
  });
}

function noRoute(task: AiTask): Error {
  return new Error(`No AI provider available for ${task}.`);
}

function trackProvider(task: AiTask, provider: AiProvider, fallback: boolean) {
  const tracked = TRACKED_TASKS[task];
  if (tracked) track("ai_provider_used", { provider, task: tracked, fallback });
  if (provider !== "local") recordAiUsage(task, provider);
}

function remoteJson(task: AiTask, route: RemoteRoute, system: string, prompt: string, schema: JsonTask) {
  return route.kind === "byok"
    ? byokCompleteJson(route.config, system, prompt, schema)
    : cloudCompleteJson(task, system, prompt, schema);
}

/**
 * Runs one structured task along its policy route and says which provider answered. An online
 * provider that fails (network, quota, bad JSON) falls through to the next; the last provider's
 * error is thrown.
 */
async function runTaskWithProvider<T>(
  task: AiTask,
  schema: JsonTask,
  system: string,
  prompt: string,
  parse: (text: string) => T,
  local: () => Promise<T>,
): Promise<{ value: T; provider: AiProvider }> {
  const routes = await routesFor(task);
  for (const [index, route] of routes.entries()) {
    try {
      const value = route.kind === "local" ? await local() : parse(await remoteJson(task, route, system, prompt, schema));
      trackProvider(task, route.kind, index > 0);
      return { value, provider: route.kind };
    } catch (error) {
      if (index === routes.length - 1) throw error;
      logger.warn("aiService", `${route.kind} ${schema.name} failed`, error);
    }
  }
  throw noRoute(task);
}

async function runTask<T>(
  task: AiTask,
  schema: JsonTask,
  system: string,
  prompt: string,
  parse: (text: string) => T,
  local: () => Promise<T>,
): Promise<T> {
  return (await runTaskWithProvider(task, schema, system, prompt, parse, local)).value;
}

function parseSummary(text: string): string {
  const parsed = JSON.parse(text) as { summary?: unknown };
  return typeof parsed.summary === "string" ? parsed.summary.trim() : "";
}

export const aiService = {
  async isAvailable(task: AiTask): Promise<boolean> {
    const routes = await routesFor(task);
    if (routes.some((route) => route.kind !== "local")) return true;
    return routes.length > 0 && (await localModelService.getReadyModel()) !== null;
  },

  /** Per-person daily costs in USD plus the provider that answered (the card names it). */
  async estimateTripBudget(input: TripBudgetEstimateInput): Promise<TripBudgetEstimate & { provider: AiProvider }> {
    const { value, provider } = await runTaskWithProvider(
      "tripBudget",
      AI_TASKS.budget,
      AI_PROMPTS.systemBudgetEstimator,
      AI_PROMPTS.budgetRequest(input),
      parseBudgetEstimate,
      () => localModelService.estimateTripBudget(input),
    );
    return { ...value, provider };
  },

  suggestTripName(input: TripNameInput): Promise<TripNameSuggestion> {
    return runTask(
      "tripName",
      AI_TASKS.tripName,
      AI_PROMPTS.systemTripNameGenerator,
      AI_PROMPTS.tripNameRequest(input),
      (text) => parseTripName(text, input.destinations),
      () => localModelService.suggestTripName(input),
    );
  },

  /** Events read from Gmail never go online: online refinement only sees manual events and keeps the rest. */
  refineItinerary(events: ItineraryEventRefinementInput[]): Promise<ItineraryEventRefinement> {
    const shareable = events.filter((event) => event.source !== "email");
    const emailIds = events.filter((event) => event.source === "email").map((event) => event.id);
    return runTask(
      "itinerary",
      AI_TASKS.itinerary,
      AI_PROMPTS.systemItineraryRefiner,
      AI_PROMPTS.itineraryRefinementRequest(refinementEvents(shareable)),
      (text) => ({ keepIds: [...parseItineraryRefinement(text, shareable).keepIds, ...emailIds] }),
      () => localModelService.refineItinerary(events),
    );
  },

  /** Raw voice fields; only the transcript text is sent online, never audio. */
  extractVoiceExpense(transcript: string, companions: string[]): Promise<unknown> {
    return runTask(
      "voiceExpense",
      AI_TASKS.voice,
      VOICE_EXTRACTION_SYSTEM_PROMPT,
      voiceExtractionRequest(transcript, companions),
      parseVoiceExtraction,
      () => localModelService.extractVoiceExpense(transcript, companions),
    );
  },

  /** Pro: line items read from a receipt's text (never the photo). There is no on-device fallback. */
  readReceiptItems(lines: string[]): Promise<ReceiptItems> {
    return runTask("receiptItems", AI_TASKS.receiptItems, RECEIPT_ITEMS_SYSTEM_PROMPT, receiptItemsRequest(lines), parseReceiptItems, () =>
      Promise.reject(new Error("Receipt items need online AI")),
    );
  },

  /** Category for one expense, or null when the model can't place it. On-device only by policy (raw email/SMS text). */
  categorizeExpense(input: ExpenseCategoryInput): Promise<ExpenseCategoryId | null> {
    return runTask(
      "expenseCategory",
      AI_TASKS.category,
      AI_PROMPTS.systemExpenseCategorizer,
      AI_PROMPTS.expenseCategoryRequest(input),
      parseExpenseCategory,
      () => localModelService.categorizeExpense(input),
    );
  },

  /**
   * Online, older turns are summarized by the online model; if that fails the chat keeps its
   * existing summary and recent turns rather than blocking the reply.
   */
  async prepareChatMemory(
    history: ChatTurn[],
    opts?: Pick<ChatOptions, "systemContext" | "conversationSummary">,
  ): Promise<ChatMemory> {
    const routes = await routesFor("chat");
    if (routes.length === 0) throw noRoute("chat");
    if (routes[0].kind === "local") return localModelService.prepareChatMemory(history, opts);
    const existingSummary = opts?.conversationSummary ?? "";
    try {
      return await compactChatMemory(
        history,
        chatSystemContent(true, opts?.systemContext, existingSummary),
        existingSummary,
        REMOTE_CONTEXT_TOKENS,
        (source) => runTask("chatSummary", AI_TASKS.summary, AI_PROMPTS.systemChatSummarizer, source, parseSummary, async () => existingSummary),
        REMOTE_MAX_TURNS,
      );
    } catch (error) {
      logger.warn("aiService", "chat memory compaction failed", error);
      return {
        summary: existingSummary || null,
        history: history.slice(-REMOTE_RECENT_TURNS_FALLBACK),
        contextTokens: REMOTE_CONTEXT_TOKENS,
      };
    }
  },

  /**
   * Streams a chat reply along the chat route. An online provider that fails before any text falls
   * through; one that fails mid-reply keeps the partial text.
   */
  async chat(history: ChatTurn[], opts?: ChatOptions): Promise<string> {
    const controller = new AbortController();
    chatAbort = controller;
    try {
      const routes = await routesFor("chat");
      const messages: RemoteMessage[] = [
        { role: "system", content: chatSystemContent(true, opts?.systemContext, opts?.conversationSummary) },
        ...history,
      ];

      for (const [index, route] of routes.entries()) {
        if (controller.signal.aborted) return "";
        if (route.kind === "local") {
          // History compacted for an online model can be far larger than the phone's context.
          let localHistory = history;
          let localOpts = opts;
          if (index > 0) {
            const memory = await localModelService.prepareChatMemory(history, opts);
            localHistory = memory.history;
            localOpts = { ...opts, conversationSummary: memory.summary ?? undefined, contextTokens: memory.contextTokens };
          }
          const reply = await localModelService.chat(localHistory, localOpts);
          trackProvider("chat", "local", index > 0);
          return reply;
        }

        let partial = "";
        const onText = (accumulated: string) => {
          const delta = accumulated.slice(partial.length);
          partial = accumulated;
          opts?.onToken?.(delta, accumulated);
        };
        try {
          const text =
            route.kind === "byok"
              ? await byokChat(route.config, messages, onText, controller.signal)
              : await cloudChat(messages, onText, controller.signal);
          trackProvider("chat", route.kind, index > 0);
          return text.trim() || partial;
        } catch (error) {
          logger.warn("aiService", `${route.kind} chat failed`, error);
          if (partial || controller.signal.aborted) return partial;
        }
      }
      if (controller.signal.aborted) return "";
      throw noRoute("chat");
    } finally {
      if (chatAbort === controller) chatAbort = null;
    }
  },

  async stopChat(): Promise<void> {
    chatAbort?.abort();
    chatAbort = null;
    await localModelService.stopChat();
  },
};
