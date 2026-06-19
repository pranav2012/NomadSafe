import { Platform } from "react-native";
import {
  loadLlamaModelInfo,
  initLlama,
  type LlamaContext,
} from "llama.rn";
import { aiModelService, AI_MODELS, type AiModel } from "./aiModelService";

export type { AiModel };

export interface TripBudgetEstimateInput {
  destinations: string[];
  days: number;
  travelerCount: number;
  currency: string;
}

export interface TripBudgetEstimate {
  total: number;
  daily: number;
  rationale: string;
}

export const LOCAL_AI_PROMPTS = {
  systemChatAssistant:
    "You are Nomad, NomadSafe's on-device travel and money assistant. " +
    "You help travelers with budgeting, spending habits, trip planning, and general travel questions. " +
    "Keep answers concise, practical, and friendly. Write in plain text — no markdown, headings, or JSON. " +
    "If you don't have the data to answer something specific about the user's spending, say so and suggest what they could log. " +
    "Everything you say stays on the user's device.",

  systemBudgetEstimator:
    "You are NomadSafe's on-device travel budget estimator. " +
    "Produce a realistic mid-range trip budget in the requested currency. " +
    "Account for lodging, meals, local transport, activities, tips, and a small buffer. " +
    "Exclude international flights and visa costs. " +
    "Use local price knowledge for the destinations. " +
    "Return only a JSON object with keys: total (number), daily (number), rationale (string under 140 characters). " +
    "Do not add markdown, explanations, or extra keys.",

  budgetRequest: (input: TripBudgetEstimateInput): string =>
    [
      `Destinations: ${input.destinations.join(", ")}`,
      `Trip length: ${input.days} day${input.days === 1 ? "" : "s"}`,
      `Travelers: ${input.travelerCount}`,
      `Currency: ${input.currency}`,
      "JSON:",
    ].join("\n"),

  systemTripNameGenerator:
    "You are a concise trip-title writer. " +
    "Write exactly one short, cool trip title (2-5 words) using ONLY the destinations and trip length provided below. " +
    "The title MUST contain real destination names from the provided list. Do not use any destination that was not provided. " +
    "Do not use placeholders, variables, or angle brackets. " +
    "Good examples for Lisbon: '7 Days in Lisbon', 'Lisbon to Porto Run', 'Lisbon Solo Sprint'. " +
    "Bad examples: '[short trip title]', '<trip_title>', 'My Trip', 'Vietnam Hop' when the destination is not Vietnam. " +
    "Return only a JSON object with a single key: name. The value must be the actual title string. " +
    "Do not add markdown, explanations, or extra keys.",

  tripNameRequest: (input: TripNameInput): string =>
    [
      `Destinations: ${input.destinations.join(", ")}`,
      `Trip length: ${input.days} day${input.days === 1 ? "" : "s"}`,
      `Travel mode: ${input.mode}`,
      `Travelers: ${input.travelerCount}`,
      "JSON:",
    ].join("\n"),
};

export type ChatRole = "system" | "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  onToken?: (delta: string, accumulated: string) => void;
  /** Extra factual context (e.g. the active trip + budget) appended to the system prompt. */
  systemContext?: string;
}

export interface TripNameInput {
  destinations: string[];
  days: number;
  mode: "solo" | "group";
  travelerCount: number;
}

export interface TripNameSuggestion {
  name: string;
}

let activeContext: LlamaContext | null = null;
let activeModelId: string | null = null;
// Shared in-flight load so a warm-up preload and the first send don't kick off
// two concurrent initLlama calls for the same model (which fails natively).
let loadInFlight: { id: string; promise: Promise<LlamaContext> } | null = null;
// Some chat templates reject the enable_thinking flag; once we see that, we stop
// passing it for the rest of the session.
let disableThinkingSupported = true;
// Number of most-recent chat turns sent to the model. Keeps the prompt bounded
// so a long saved conversation can't overflow the context window.
const CHAT_HISTORY_TURNS = 10;

function isActiveModelId(id: string): boolean {
  return activeModelId === id;
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
}

function normalizeEstimate(value: unknown): TripBudgetEstimate {
  const candidate = value as Partial<TripBudgetEstimate>;
  const total = Number(candidate.total);
  const daily = Number(candidate.daily);

  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(daily) || daily <= 0) {
    throw new Error("Local model returned an invalid budget estimate.");
  }

  return {
    total: Math.round(total),
    daily: Math.round(daily),
    rationale:
      typeof candidate.rationale === "string" && candidate.rationale.trim()
        ? candidate.rationale.trim()
        : "Estimated from destination, trip length, and travelers.",
  };
}

async function getReadyModel(): Promise<AiModel | null> {
  const activeId = aiModelService.getActiveModelId();
  const selectedIds = [
    activeId,
    aiModelService.getSelectedModelId(),
    aiModelService.getDownloadedModelId(),
    (await localModelService.getAssignedModel())?.id,
  ].filter(Boolean);

  for (const id of selectedIds) {
    const model = AI_MODELS.find((candidate) => candidate.id === id);
    if (model && (await localModelService.isDownloaded(model))) {
      return model;
    }
  }

  for (const model of AI_MODELS) {
    if (await localModelService.isDownloaded(model)) {
      aiModelService.setDownloadedModelId(model.id);
      return model;
    }
  }

  return null;
}

export const localModelService = {
  /**
   * Checks whether a model file is present locally.
   */
  async isDownloaded(model: AiModel): Promise<boolean> {
    return aiModelService.isModelDownloaded(model);
  },

  /**
   * Returns the id of the model currently loaded in RAM, if any.
   */
  getActiveModelId(): string | null {
    return activeModelId;
  },

  /**
   * Returns whether the given model is loaded and ready for inference.
   */
  isModelLoaded(model: AiModel): boolean {
    return isActiveModelId(model.id) && activeContext !== null;
  },

  /**
   * Sets the active/default model in storage without loading it. Inference will
   * lazily load it when needed.
   */
  setDefaultModel(model: AiModel): void {
    aiModelService.setActiveModelId(model.id);
    aiModelService.setSelectedModelId(model.id);
    aiModelService.setDownloadedModelId(model.id);
  },

  /**
   * Loads the model into memory only when needed. Keeps at most one context
   * alive at a time to avoid running out of RAM.
   */
  async loadModel(model: AiModel): Promise<LlamaContext> {
    if (activeContext && activeModelId === model.id) {
      return activeContext;
    }
    // Reuse an in-flight load for the same model instead of starting another.
    if (loadInFlight && loadInFlight.id === model.id) {
      return loadInFlight.promise;
    }

    const path = aiModelService.getLocalModelPath(model);
    const promise = (async () => {
      await localModelService.release();
      /**
       * Try a fast config first, then fall back to plain CPU if it fails.
       * - n_gpu_layers: on iOS we offload all layers to the Metal GPU for a large
       *   generation speedup, but some device/model combos can't allocate it.
       * - flash_attn_type "auto": speeds up attention when the backend supports
       *   it, but is not available everywhere.
       * If either makes initLlama throw, we retry on CPU so chat still works.
       * - n_ctx: 4096 leaves room for the system prompt, the trip/money context,
       *   a few recent chat turns, and up to n_predict generated tokens.
       * - use_mlock: false avoids pinning pages in RAM while backgrounded.
       */
      const baseParams = { model: path, use_mlock: false, n_ctx: 4096 } as const;
      let context: LlamaContext;
      try {
        context = await initLlama({
          ...baseParams,
          n_gpu_layers: Platform.OS === "ios" ? 99 : 0,
          flash_attn_type: "auto",
        });
      } catch (err) {
        console.warn("[localModelService] fast load failed, retrying on CPU", err);
        context = await initLlama({ ...baseParams, n_gpu_layers: 0 });
      }
      activeContext = context;
      activeModelId = model.id;
      return context;
    })();

    loadInFlight = { id: model.id, promise };
    try {
      return await promise;
    } finally {
      loadInFlight = null;
    }
  },

  /**
   * Releases the currently loaded model context to free memory.
   */
  async release(): Promise<void> {
    if (activeContext) {
      try {
        await activeContext.release();
      } catch {
        // ignore
      }
      activeContext = null;
      activeModelId = null;
    }
  },

  /**
   * Returns the best model for this device tier. Returns null if local AI is
   * not supported at all.
   */
  async getAssignedModel(): Promise<AiModel | null> {
    const capability = await aiModelService.checkDeviceCapability();
    if (!capability.supported) return null;
    const model = AI_MODELS.find((m) => m.id === capability.assignedCategory);
    return model ?? null;
  },

  /**
   * Quick sanity check that the GGUF file can be read by llama.cpp.
   */
  async validateModel(model: AiModel): Promise<void> {
    const path = aiModelService.getLocalModelPath(model);
    await loadLlamaModelInfo(path);
  },

  async getReadyModel(): Promise<AiModel | null> {
    return getReadyModel();
  },

  /**
   * Warms up the downloaded model by loading it into memory ahead of the first
   * message, so initial replies aren't stuck behind a multi-second model load.
   * No-op if no model is downloaded or one is already loaded.
   */
  async preload(): Promise<void> {
    const model = await getReadyModel();
    if (!model || localModelService.isModelLoaded(model)) return;
    try {
      await localModelService.loadModel(model);
    } catch {
      // best-effort warm-up; the next send will surface any real error
    }
  },

  /**
   * Streams a free-form chat reply from the local model. `history` is the prior
   * conversation (excluding the system prompt, which is prepended here). The
   * optional onToken callback fires for each generated token with the latest
   * delta and the full accumulated text so far.
   */
  async chat(history: ChatTurn[], opts?: ChatOptions): Promise<string> {
    const model = await localModelService.getReadyModel();
    if (!model) {
      throw new Error("Local AI model is not downloaded.");
    }

    const context = await localModelService.loadModel(model);
    const systemContent = opts?.systemContext
      ? `${LOCAL_AI_PROMPTS.systemChatAssistant}\n\n${opts.systemContext}`
      : LOCAL_AI_PROMPTS.systemChatAssistant;
    // Only send the most recent turns so the prompt stays well within n_ctx no
    // matter how long the saved conversation grows.
    const recentHistory = history.slice(-CHAT_HISTORY_TURNS);
    const messages: ChatTurn[] = [
      { role: "system", content: systemContent },
      ...recentHistory,
    ];

    const onToken = (data: { token: string; accumulated_text?: string }) =>
      opts?.onToken?.(data.token, data.accumulated_text ?? "");
    const params = { messages, jinja: true, n_predict: 512, temperature: 0.6, top_p: 0.9 } as const;

    // Prefer skipping Qwen's reasoning chain (faster replies), but some chat
    // templates reject the enable_thinking flag and throw before generating.
    // If that happens once, disable the flag for the rest of the session and
    // retry with a plain completion so chat keeps working.
    if (disableThinkingSupported) {
      try {
        const result = await context.completion({ ...params, enable_thinking: false }, onToken);
        return result.text.trim();
      } catch (err) {
        console.warn("[localModelService] enable_thinking rejected, retrying without it", err);
        disableThinkingSupported = false;
      }
    }

    const result = await context.completion(params, onToken);
    return result.text.trim();
  },

  /**
   * Stops an in-flight chat completion (e.g. on screen unmount).
   */
  async stopChat(): Promise<void> {
    if (activeContext) {
      try {
        await activeContext.stopCompletion();
      } catch {
        // ignore
      }
    }
  },

  async estimateTripBudget(input: TripBudgetEstimateInput): Promise<TripBudgetEstimate> {
    const model = await localModelService.getReadyModel();
    if (!model) {
      throw new Error("Local AI model is not downloaded.");
    }

    const context = await localModelService.loadModel(model);
    const prompt =
      LOCAL_AI_PROMPTS.systemBudgetEstimator + "\n\n" + LOCAL_AI_PROMPTS.budgetRequest(input);

    const result = await context.completion({
      prompt,
      n_predict: 220,
      temperature: 0.25,
      response_format: { type: "json_object" },
    });

    return normalizeEstimate(JSON.parse(extractJsonObject(result.text)));
  },

  async suggestTripName(input: TripNameInput): Promise<TripNameSuggestion> {
    const model = await localModelService.getReadyModel();
    if (!model) {
      throw new Error("Local AI model is not downloaded.");
    }

    const context = await localModelService.loadModel(model);
    const prompt =
      LOCAL_AI_PROMPTS.systemTripNameGenerator + "\n\n" + LOCAL_AI_PROMPTS.tripNameRequest(input);

    const result = await context.completion({
      prompt,
      n_predict: 90,
      temperature: 0.65,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(extractJsonObject(result.text)) as Partial<TripNameSuggestion>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) {
      throw new Error("Local model returned an empty trip name.");
    }

    return { name };
  },
};
