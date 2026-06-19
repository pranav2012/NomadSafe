import {
  loadLlamaModelInfo,
  initLlama,
  type LlamaContext,
} from "llama.rn";
import { aiModelService, AI_MODELS, type AiModel } from "./aiModelService";

export type { AiModel };

let activeContext: LlamaContext | null = null;
let activeModelId: string | null = null;

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
};
