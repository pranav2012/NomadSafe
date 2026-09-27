import * as Device from "expo-device";
import { Paths, Directory, File } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { storage } from "@/stores/storage";
import { memoryInfo } from "./memoryInfo";

export function formatModelSize(sizeMb: number, locale?: string): string {
  const useGb = sizeMb >= 1024;
  const value = useGb ? sizeMb / 1024 : sizeMb;
  try {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: useGb ? "gigabyte" : "megabyte",
      unitDisplay: "short",
      maximumFractionDigits: useGb ? 1 : 0,
    }).format(value);
  } catch {
    return useGb ? `${value.toFixed(1)} GB` : `${Math.round(value)} MB`;
  }
}

export interface DeviceCapability {
  totalMemoryGb: number;
  supported: boolean;
  limited: boolean;
  reason: "ok" | "lowRam" | "oldOs" | "unknown";
  assignedCategory: AiModelCategory;
}

export type AiModelCategory = "compact" | "balanced";

export interface AiModel {
  id: AiModelCategory;
  name: string;
  sizeMb: number;
  minRamGb: number;
  recommendedRamGb: number;
  descriptionKey: string;
  /** HuggingFace repo ID for the GGUF source. */
  hfRepoId: string;
  /** Exact GGUF filename inside the repo. */
  hfFilename: string;
  /** Quantization label shown to the user. */
  quantLabel: string;
  /** Exact file size in bytes, when known; otherwise the HTTP size is used. */
  sizeBytes?: number;
}

export interface ContextWindowPlan {
  tokens: number;
  availableMemoryBytes: number | null;
}

/**
 * Two device tiers mapped to real, openly licensed Qwen 3.5 GGUF models.
 *
 * We chose Qwen 3.5 because the app is a text-first travel assistant that must
 * work across 14 locales. Qwen 3.5 is explicitly optimized for multilingual text,
 * supports 201 languages/dialects, and its vision encoder can be skipped entirely
 * for a text-only deployment, keeping disk/RAM/battery usage lower.
 *
 * Base -> Qwen3.5-0.8B-Instruct Q4_K_M (~520 MB)
 * Pro  -> Qwen3.5-4B-Instruct  Q4_K_M (~2.6 GB)
 *
 * All GGUFs are from the bartowski community mirror, which is the de facto
 * standard for llama.cpp / llama.rn users.
 */
export const AI_MODELS: AiModel[] = [
  {
    id: "compact",
    name: "NomadBase",
    sizeMb: 520,
    minRamGb: 3,
    recommendedRamGb: 4,
    descriptionKey: "onboarding.modelSizeCompact",
    hfRepoId: "bartowski/Qwen_Qwen3.5-0.8B-GGUF",
    hfFilename: "Qwen_Qwen3.5-0.8B-Q4_K_M.gguf",
    quantLabel: "Q4_K_M",
  },
  {
    id: "balanced",
    name: "NomadPro",
    sizeMb: 2620,
    minRamGb: 4,
    recommendedRamGb: 6,
    descriptionKey: "onboarding.modelSizeBalanced",
    hfRepoId: "bartowski/Qwen_Qwen3.5-4B-GGUF",
    hfFilename: "Qwen_Qwen3.5-4B-Q4_K_M.gguf",
    quantLabel: "Q4_K_M",
  },
];

const AI_MODEL_ID_KEY = "ai-selected-model-id";
const AI_MODEL_DOWNLOADED_KEY = "ai-downloaded-model-id";
const AI_ACTIVE_MODEL_ID_KEY = "ai-active-model-id";
export const AI_DOWNLOAD_STATE_KEY = "ai-download-state";
const MB = 1024 * 1024;
// Coarse floor against truncated files / HTML error pages; sizeMb is approximate.
const MIN_COMPLETE_FRACTION = 0.8;

let legacyMigration: Promise<void> | null = null;

function legacyAndroidModelPath(model: AiModel): string {
  return `${Paths.cache.uri}models/${model.id}/${model.hfFilename}`;
}

function minimumCompleteBytes(model: AiModel): number {
  return model.sizeBytes ?? Math.floor(model.sizeMb * MB * MIN_COMPLETE_FRACTION);
}

async function fileSize(uri: string): Promise<number | null> {
  try {
    const info = await LegacyFileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? info.size : null;
  } catch {
    return null;
  }
}

function hasUnfinishedDownload(model: AiModel): boolean {
  const raw = storage.getString(AI_DOWNLOAD_STATE_KEY);
  if (!raw) return false;
  try {
    const persisted = JSON.parse(raw) as { modelId?: string; status?: string };
    return persisted.modelId === model.id && persisted.status !== "completed";
  } catch {
    return false;
  }
}

/**
 * Android builds used to store models in the purgeable cache dir, written in
 * place. Move complete files to the documents dir; drop partial ones.
 */
async function migrateLegacyAndroidModels(): Promise<void> {
  if (Platform.OS !== "android") return;
  for (const model of AI_MODELS) {
    const legacyPath = legacyAndroidModelPath(model);
    try {
      const size = await fileSize(legacyPath);
      if (size === null) continue;
      const target = aiModelService.getLocalModelPath(model);
      const complete = !hasUnfinishedDownload(model) && size >= minimumCompleteBytes(model);
      if (complete && (await fileSize(target)) === null) {
        await aiModelService.ensureModelDir(model);
        await LegacyFileSystem.moveAsync({ from: legacyPath, to: target });
      } else {
        await LegacyFileSystem.deleteAsync(legacyPath, { idempotent: true });
      }
    } catch (err) {
      console.warn("[aiModelService] legacy model migration failed", err);
    }
  }
}

function getOsVersion(): number {
  if (Platform.OS === "android") {
    return typeof Device.platformApiLevel === "number" ? Device.platformApiLevel : 0;
  }
  const version = Device.osVersion?.split(".")[0];
  return version ? Number.parseInt(version, 10) || 0 : 0;
}

function getTotalMemoryGb(): number {
  if (typeof Device.totalMemory === "number" && Device.totalMemory > 0) {
    return Math.round(Device.totalMemory / 1024 / 1024 / 1024);
  }
  return 0;
}

function assignCategory(totalMemoryGb: number): AiModelCategory {
  if (totalMemoryGb >= AI_MODELS[1].recommendedRamGb) return "balanced";
  return "compact";
}

function contextWindowFor(model: AiModel, availableMemoryBytes: number | null): number {
  if (availableMemoryBytes === null) return 4096;

  const availableMb = availableMemoryBytes / 1024 / 1024;
  if (availableMb < 1200) return 4096;
  if (availableMb < 2800) return Math.min(model.id === "compact" ? 8192 : 6144, 8192);
  return model.id === "compact" ? 8192 : 12288;
}

export const aiModelService = {
  getContextWindowPlan(model: AiModel): ContextWindowPlan {
    const availableMemoryBytes = memoryInfo.getAvailableMemoryBytes();
    return {
      tokens: contextWindowFor(model, availableMemoryBytes),
      availableMemoryBytes,
    };
  },

  async checkDeviceCapability(): Promise<DeviceCapability> {
    const totalMemoryGb = getTotalMemoryGb();
    const osVersion = getOsVersion();

    if (totalMemoryGb === 0) {
      return {
        totalMemoryGb: 0,
        supported: false,
        limited: true,
        reason: "unknown",
        assignedCategory: "compact",
      };
    }

    const minRam = AI_MODELS[0].minRamGb;
    if (totalMemoryGb < minRam) {
      return {
        totalMemoryGb,
        supported: false,
        limited: false,
        reason: "lowRam",
        assignedCategory: "compact",
      };
    }

    const isOldOs =
      (Platform.OS === "ios" && osVersion < 15) ||
      (Platform.OS === "android" && osVersion < 26);

    if (isOldOs) {
      return {
        totalMemoryGb,
        supported: false,
        limited: true,
        reason: "oldOs",
        assignedCategory: "compact",
      };
    }

    const category = assignCategory(totalMemoryGb);
    const limited = totalMemoryGb < AI_MODELS[1].recommendedRamGb;
    return { totalMemoryGb, supported: true, limited, reason: "ok", assignedCategory: category };
  },

  getAvailableModels(capability: DeviceCapability): AiModel[] {
    if (!capability.supported) return [];
    return AI_MODELS.filter((m) => capability.totalMemoryGb >= m.minRamGb);
  },

  getSelectedModelId(): string | null {
    return storage.getString(AI_MODEL_ID_KEY) ?? null;
  },

  setSelectedModelId(id: string) {
    storage.set(AI_MODEL_ID_KEY, id);
  },

  getDownloadedModelId(): string | null {
    return storage.getString(AI_MODEL_DOWNLOADED_KEY) ?? null;
  },

  setDownloadedModelId(id: string | null) {
    storage.set(AI_MODEL_DOWNLOADED_KEY, id ?? "");
  },

  getActiveModelId(): string | null {
    return storage.getString(AI_ACTIVE_MODEL_ID_KEY) ?? null;
  },

  setActiveModelId(id: string | null) {
    storage.set(AI_ACTIVE_MODEL_ID_KEY, id ?? "");
  },

  getModelDownloadUrl(model: AiModel): string {
    return `https://huggingface.co/${model.hfRepoId}/resolve/main/${model.hfFilename}`;
  },

  /**
   * Models live in the documents dir on both platforms: Android may purge the
   * cache dir under storage pressure. On iOS the documents dir is included in
   * iCloud backups and expo-file-system has no exclude-from-backup API.
   */
  getLocalModelDir(model: AiModel): string {
    return `${Paths.document.uri}models/${model.id}/`;
  },

  async ensureModelDir(model: AiModel): Promise<void> {
    const dir = new Directory(aiModelService.getLocalModelDir(model));
    if (!dir.exists) {
      await dir.create({ intermediates: true });
    }
  },

  getLocalModelPath(model: AiModel): string {
    return `${aiModelService.getLocalModelDir(model)}${model.hfFilename}`;
  },

  /** In-progress downloads are written here and renamed once verified. */
  getPartialModelPath(model: AiModel): string {
    return `${aiModelService.getLocalModelPath(model)}.part`;
  },

  getMinimumCompleteBytes(model: AiModel): number {
    return minimumCompleteBytes(model);
  },

  /** Moves models from older storage locations. Runs once per launch. */
  migrateLegacyStorage(): Promise<void> {
    legacyMigration ??= migrateLegacyAndroidModels();
    return legacyMigration;
  },

  /** True only for a fully downloaded file at the final (non-.part) path. */
  async isModelDownloaded(model: AiModel): Promise<boolean> {
    await aiModelService.migrateLegacyStorage();
    const size = await fileSize(aiModelService.getLocalModelPath(model));
    return size !== null && size >= minimumCompleteBytes(model);
  },

  /**
   * Removes a downloaded model file from disk. Safe to call even if the file
   * does not exist. Returns true if the file was present and removed.
   */
  async deleteModel(model: AiModel): Promise<boolean> {
    const partial = new File(aiModelService.getPartialModelPath(model));
    if (partial.exists) partial.delete();
    const file = new File(aiModelService.getLocalModelPath(model));
    if (!file.exists) return false;
    file.delete();
    return true;
  },
};
