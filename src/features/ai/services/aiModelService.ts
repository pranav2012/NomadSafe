import * as Device from "expo-device";
import {
  Paths,
  Directory,
  File,
  type DownloadOptions,
  type DownloadProgress,
} from "expo-file-system";
import { Platform } from "react-native";
import { storage } from "@/stores/storage";

export interface DeviceCapability {
  totalMemoryGb: number;
  supported: boolean;
  limited: boolean;
  reason: "ok" | "lowRam" | "oldOs" | "unknown";
  assignedCategory: AiModelCategory;
}

export type AiModelCategory = "compact" | "balanced" | "capable";

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
}

/**
 * Three device tiers mapped to real, openly licensed Qwen 3.5 GGUF models.
 *
 * We chose Qwen 3.5 because the app is a text-first travel assistant that must
 * work across 14 locales. Qwen 3.5 is explicitly optimized for multilingual text,
 * supports 201 languages/dialects, and its vision encoder can be skipped entirely
 * for a text-only deployment, keeping disk/RAM/battery usage lower.
 *
 * Compact  -> Qwen3.5-0.8B-Instruct Q4_K_M (~520 MB)
 * Balanced -> Qwen3.5-4B-Instruct  Q4_K_M (~2.6 GB)
 * Capable  -> Qwen3.5-9B-Instruct  Q4_K_M (~5.7 GB)
 *
 * All GGUFs are from the bartowski community mirror, which is the de facto
 * standard for llama.cpp / llama.rn users.
 */
export const AI_MODELS: AiModel[] = [
  {
    id: "compact",
    name: "NomadMini",
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
    name: "NomadBase",
    sizeMb: 2620,
    minRamGb: 4,
    recommendedRamGb: 6,
    descriptionKey: "onboarding.modelSizeBalanced",
    hfRepoId: "bartowski/Qwen_Qwen3.5-4B-GGUF",
    hfFilename: "Qwen_Qwen3.5-4B-Q4_K_M.gguf",
    quantLabel: "Q4_K_M",
  },
  {
    id: "capable",
    name: "NomadPro",
    sizeMb: 5700,
    minRamGb: 6,
    recommendedRamGb: 8,
    descriptionKey: "onboarding.modelSizeCapable",
    hfRepoId: "bartowski/Qwen_Qwen3.5-9B-GGUF",
    hfFilename: "Qwen_Qwen3.5-9B-Q4_K_M.gguf",
    quantLabel: "Q4_K_M",
  },
];

const AI_MODEL_ID_KEY = "ai-selected-model-id";
const AI_MODEL_DOWNLOADED_KEY = "ai-downloaded-model-id";

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
  if (totalMemoryGb >= AI_MODELS[2].recommendedRamGb) return "capable";
  if (totalMemoryGb >= AI_MODELS[1].minRamGb) return "balanced";
  return "compact";
}

export const aiModelService = {
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

  getModelDownloadUrl(model: AiModel): string {
    return `https://huggingface.co/${model.hfRepoId}/resolve/main/${model.hfFilename}`;
  },

  getLocalModelDir(model: AiModel): string {
    return Platform.OS === "ios"
      ? `${Paths.document.uri}models/${model.id}/`
      : `${Paths.cache.uri}models/${model.id}/`;
  },

  async ensureModelDir(model: AiModel): Promise<void> {
    const dir = new Directory(aiModelService.getLocalModelDir(model));
    if (!dir.exists) {
      await dir.create({ intermediates: true });
    }
  },

  getLocalModelPath(model: AiModel): string {
    // Models live in the app's documents directory so they are not backed up to iCloud
    // and can be loaded on demand by llama.rn.
    return `${aiModelService.getLocalModelDir(model)}${model.hfFilename}`;
  },

  async downloadModel(
    model: AiModel,
    onProgress?: (progress: number) => void,
  ): Promise<void> {
    const dir = new Directory(aiModelService.getLocalModelDir(model));
    await dir.create({ intermediates: true });

    const options: DownloadOptions = {
      idempotent: true,
      onProgress: (downloadProgress: DownloadProgress) => {
        const total = downloadProgress.totalBytes > 0 ? downloadProgress.totalBytes : model.sizeMb * 1024 * 1024;
        const percent = total > 0
          ? Math.round((downloadProgress.bytesWritten / total) * 100)
          : 0;
        onProgress?.(Math.min(Math.max(percent, 0), 100));
      },
    };

    await File.downloadFileAsync(
      aiModelService.getModelDownloadUrl(model),
      dir,
      options,
    );
  },

  async isModelDownloaded(model: AiModel): Promise<boolean> {
    const file = new File(aiModelService.getLocalModelPath(model));
    return file.exists;
  },
};
