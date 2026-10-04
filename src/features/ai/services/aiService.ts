import * as Network from "expo-network";
import { useAuthStore } from "@/features/auth/store/authStore";
import { usePlanStore } from "@/features/billing/store/planStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { VOICE_EXTRACTION_SYSTEM_PROMPT, voiceExtractionRequest } from "@/features/expenses/services/voiceExpense";
import { track } from "@/services/analytics";
import { logger } from "@/services/logger";
import { AI_TASKS, type JsonTask } from "./aiSchemas";
import {
  AI_PROMPTS,
  chatSystemContent,
  parseBudgetEstimate,
  parseItineraryRefinement,
  parseTripName,
  parseVoiceExtraction,
  refinementEvents,
  type ChatMemory,
  type ChatOptions,
  type ChatTurn,
  type ItineraryEventRefinement,
  type ItineraryEventRefinementInput,
  type TripBudgetEstimate,
  type TripBudgetEstimateInput,
  type TripNameInput,
  type TripNameSuggestion,
} from "./aiPrompts";
import { compactChatMemory } from "./chatMemory";
import { localModelService } from "./localModelService";
import { byokChat, byokCompleteJson, getByokConfig } from "./remote/byok";
import { cloudChat, cloudCompleteJson, isCloudExhausted, type CloudKind } from "./remote/cloud";
import type { ByokConfig, RemoteMessage } from "./remote/providers";

type Route = { kind: "byok"; config: ByokConfig } | { kind: "cloud" };
type TrackedTask = "chat" | "budget" | "trip_name" | "itinerary" | "voice";

// Online models have far larger windows; this only bounds what a long chat sends each turn.
const REMOTE_CONTEXT_TOKENS = 24_000;
// The cloud endpoint accepts at most 60 messages, including the system prompt.
const REMOTE_MAX_TURNS = 40;
const RECENT_TURNS_WITHOUT_SUMMARY = 12;

let chatAbort: AbortController | null = null;

/** Whether a request could go online at all (ignoring connectivity), for callers that trim what they send. */
export function mayUseOnlineAi(): boolean {
  if (!useSettingsStore.getState().onlineAiEnabled) return false;
  return getByokConfig() !== null || (usePlanStore.getState().cloudAi && useAuthStore.getState().isSignedIn);
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch {
    return false;
  }
}

/** Online routes in priority order (own key, then NomadSafe Cloud); empty when offline or turned off. */
async function onlineRoutes(kind: CloudKind): Promise<Route[]> {
  if (!useSettingsStore.getState().onlineAiEnabled) return [];
  const byok = getByokConfig();
  const cloud = usePlanStore.getState().cloudAi && useAuthStore.getState().isSignedIn && !isCloudExhausted(kind);
  if (!byok && !cloud) return [];
  if (!(await isOnline())) return [];
  const routes: Route[] = [];
  if (byok) routes.push({ kind: "byok", config: byok });
  if (cloud) routes.push({ kind: "cloud" });
  return routes;
}

function remoteJson(route: Route, system: string, prompt: string, task: JsonTask) {
  return route.kind === "byok" ? byokCompleteJson(route.config, system, prompt, task) : cloudCompleteJson(system, prompt, task);
}

/**
 * Runs one structured task online when possible, falling through to the next route on any error
 * (network, quota, bad JSON) and finally to the on-device model.
 */
async function runTask<T>(
  tracked: TrackedTask | null,
  task: JsonTask,
  system: string,
  prompt: string,
  parse: (text: string) => T,
  local: () => Promise<T>,
): Promise<T> {
  const routes = await onlineRoutes("tasks");
  for (const [index, route] of routes.entries()) {
    try {
      const result = parse(await remoteJson(route, system, prompt, task));
      if (tracked) track("ai_provider_used", { provider: route.kind, task: tracked, fallback: index > 0 });
      return result;
    } catch (error) {
      logger.warn("aiService", `${route.kind} ${task.name} failed`, error);
    }
  }
  const result = await local();
  if (tracked) track("ai_provider_used", { provider: "local", task: tracked, fallback: routes.length > 0 });
  return result;
}

function parseSummary(text: string): string {
  const parsed = JSON.parse(text) as { summary?: unknown };
  return typeof parsed.summary === "string" ? parsed.summary.trim() : "";
}

export const aiService = {
  async isAvailable(): Promise<boolean> {
    if ((await onlineRoutes("tasks")).length > 0) return true;
    return (await localModelService.getReadyModel()) !== null;
  },

  estimateTripBudget(input: TripBudgetEstimateInput): Promise<TripBudgetEstimate> {
    return runTask(
      "budget",
      AI_TASKS.budget,
      AI_PROMPTS.systemBudgetEstimator,
      AI_PROMPTS.budgetRequest(input),
      parseBudgetEstimate,
      () => localModelService.estimateTripBudget(input),
    );
  },

  suggestTripName(input: TripNameInput): Promise<TripNameSuggestion> {
    return runTask(
      "trip_name",
      AI_TASKS.tripName,
      AI_PROMPTS.systemTripNameGenerator,
      AI_PROMPTS.tripNameRequest(input),
      parseTripName,
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
      "voice",
      AI_TASKS.voice,
      VOICE_EXTRACTION_SYSTEM_PROMPT,
      voiceExtractionRequest(transcript, companions),
      parseVoiceExtraction,
      () => localModelService.extractVoiceExpense(transcript, companions),
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
    const routes = await onlineRoutes("chat");
    if (routes.length === 0) return localModelService.prepareChatMemory(history, opts);
    const existingSummary = opts?.conversationSummary ?? "";
    try {
      return await compactChatMemory(
        history,
        chatSystemContent(true, opts?.systemContext, existingSummary),
        existingSummary,
        REMOTE_CONTEXT_TOKENS,
        (source) => runTask(null, AI_TASKS.summary, AI_PROMPTS.systemChatSummarizer, source, parseSummary, async () => existingSummary),
        REMOTE_MAX_TURNS,
      );
    } catch (error) {
      logger.warn("aiService", "chat memory compaction failed", error);
      return {
        summary: existingSummary || null,
        history: history.slice(-RECENT_TURNS_WITHOUT_SUMMARY),
        contextTokens: REMOTE_CONTEXT_TOKENS,
      };
    }
  },

  /**
   * Streams a chat reply from the first online route that answers, else the on-device model.
   * A route that fails before any text falls through; one that fails mid-reply keeps the partial text.
   */
  async chat(history: ChatTurn[], opts?: ChatOptions): Promise<string> {
    const controller = new AbortController();
    chatAbort = controller;
    try {
      const routes = await onlineRoutes("chat");
      const messages: RemoteMessage[] = [
        { role: "system", content: chatSystemContent(true, opts?.systemContext, opts?.conversationSummary) },
        ...history,
      ];

      for (const [index, route] of routes.entries()) {
        if (controller.signal.aborted) return "";
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
          track("ai_provider_used", { provider: route.kind, task: "chat", fallback: index > 0 });
          return text.trim() || partial;
        } catch (error) {
          logger.warn("aiService", `${route.kind} chat failed`, error);
          if (partial || controller.signal.aborted) return partial;
        }
      }
      if (controller.signal.aborted) return "";

      // History compacted for an online model can be far larger than the phone's context.
      let localHistory = history;
      let localOpts = opts;
      if (routes.length > 0) {
        const memory = await localModelService.prepareChatMemory(history, opts);
        localHistory = memory.history;
        localOpts = { ...opts, conversationSummary: memory.summary ?? undefined, contextTokens: memory.contextTokens };
      }
      const reply = await localModelService.chat(localHistory, localOpts);
      track("ai_provider_used", { provider: "local", task: "chat", fallback: routes.length > 0 });
      return reply;
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
