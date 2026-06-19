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
  const preferredIds = [
    aiModelService.getSelectedModelId(),
    aiModelService.getDownloadedModelId(),
    (await localModelService.getAssignedModel())?.id,
  ].filter(Boolean);

  for (const id of preferredIds) {
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
   * Loads the model into memory only when needed. Keeps at most one context
   * alive at a time to avoid running out of RAM.
   */
  async loadModel(model: AiModel): Promise<LlamaContext> {
    if (activeContext && activeModelId === model.id) {
      return activeContext;
    }
    await localModelService.release();

    const path = aiModelService.getLocalModelPath(model);
    /**
     * Battery and responsiveness settings:
     * - n_gpu_layers: 0 keeps the model on the CPU. This avoids GPU-related
     *   battery/thermal spikes and is supported on every device llama.rn ships for.
     * - n_ctx: 2048 is enough for short travel QA and translation; doubling it
     *   would sharply increase RAM use during inference.
     * - use_mlock: false avoids holding pages in RAM indefinitely while the app
     *   is backgrounded.
     * - n_threads: undefined lets llama.cpp pick a sensible default (usually 4
     *   or CPU count), which is faster than forcing a single thread while still
     *   leaving headroom for the OS.
     */
    activeContext = await initLlama({
      model: path,
      use_mlock: false,
      n_ctx: 2048,
      n_gpu_layers: 0,
    });
    activeModelId = model.id;
    return activeContext;
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
