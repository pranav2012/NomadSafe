import * as Device from "expo-device";
import { Paths, Directory } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { storage } from "@/stores/storage";
import { memoryInfo } from "./memoryInfo";
import { systemDownloader } from "./systemDownloader";
import {
  AI_MODELS,
  findModel,
  LEGACY_MODEL_IDS,
  nominalRamGb,
  type AiModel,
  type AiModelId,
} from "./modelCatalog";

export * from "./modelCatalog";

const MB = 1024 * 1024;

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

export function formatBytes(bytes: number, locale?: string): string {
  return formatModelSize(Math.max(0, bytes) / MB, locale);
}

export interface DeviceProfile {
  totalRamGb: number;
  osSupported: boolean;
}

export interface ContextWindowPlan {
  tokens: number;
  availableMemoryBytes: number | null;
}

/** The model file used for inference. `verifiedKey` is null for an unverified file kept from an older build. */
export interface ActiveModelRecord {
  id: AiModelId;
  path: string;
  size: number;
  verifiedKey: string | null;
}

export interface LegacyModelFile {
  model: AiModel;
  uri: string;
}

const ACTIVE_MODEL_KEY = "ai-active-model";
const LEGACY_ACTIVE_ID_KEY = "ai-active-model-id";
const LEGACY_DOWNLOADED_ID_KEY = "ai-downloaded-model-id";
const LEGACY_SELECTED_ID_KEY = "ai-selected-model-id";
export const AI_DOWNLOAD_STATE_KEY = "ai-download-state";
// Old cache-dir files were written in place, so a partial one could be left behind.
const LEGACY_CACHE_MIN_FRACTION = 0.8;

let legacyMigration: Promise<void> | null = null;

function getOsVersion(): number {
  if (Platform.OS === "android") {
    return typeof Device.platformApiLevel === "number" ? Device.platformApiLevel : 0;
  }
  const version = Device.osVersion?.split(".")[0];
  return version ? Number.parseInt(version, 10) || 0 : 0;
}

function getTotalMemoryGb(): number {
  return nominalRamGb(Device.totalMemory);
}

function contextWindowFor(model: AiModel, availableMemoryBytes: number | null): number {
  if (availableMemoryBytes === null) return 4096;
  const small = model.id === "lite";
  const availableMb = availableMemoryBytes / MB;
  if (availableMb < 1200) return 4096;
  if (availableMb < 2800) return small ? 8192 : 6144;
  return small ? 8192 : 12288;
}

let cachedNativeDir: string | null = null;

// Throws natively while shared storage is unmounted; callers then see a missing file.
function nativeModelsDir(): string | null {
  if (!systemDownloader) return null;
  if (cachedNativeDir) return cachedNativeDir;
  try {
    cachedNativeDir = systemDownloader.getModelsDirectory();
    return cachedNativeDir;
  } catch (err) {
    console.warn("[aiModelService] models directory unavailable", err);
    return null;
  }
}

export function toNativePath(uri: string): string {
  return uri.startsWith("file://") ? decodeURI(uri.slice("file://".length)) : uri;
}

/** File size in bytes, or null when missing. Uses the native module on Android so external paths work. */
export async function modelFileSize(uri: string): Promise<number | null> {
  try {
    if (systemDownloader) {
      const size = await systemDownloader.fileSize(toNativePath(uri));
      return size >= 0 ? size : null;
    }
    const info = await LegacyFileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? info.size : null;
  } catch {
    return null;
  }
}

export async function deleteModelFile(uri: string): Promise<void> {
  try {
    if (systemDownloader) {
      await systemDownloader.deleteFile(toNativePath(uri));
      return;
    }
    await LegacyFileSystem.deleteAsync(uri, { idempotent: true });
  } catch {}
}

function legacyDocumentUri(legacyId: string, model: AiModel): string {
  return `${Paths.document.uri}models/${legacyId}/${model.hfFilename}`;
}

function legacyCacheUri(legacyId: string, model: AiModel): string {
  return `${Paths.cache.uri}models/${legacyId}/${model.hfFilename}`;
}

function legacyEntries(): { legacyId: string; model: AiModel }[] {
  return Object.entries(LEGACY_MODEL_IDS).flatMap(([legacyId, id]) => {
    const model = AI_MODELS.find((m) => m.id === id);
    return model ? [{ legacyId, model }] : [];
  });
}

/**
 * One-time move of old Android cache-dir models into the documents dir (same
 * volume, so it's a rename). Partial or unfinished files are dropped.
 */
async function migrateLegacyCacheFiles(): Promise<void> {
  if (Platform.OS !== "android") return;
  for (const { legacyId, model } of legacyEntries()) {
    const cacheUri = legacyCacheUri(legacyId, model);
    try {
      const info = await LegacyFileSystem.getInfoAsync(cacheUri);
      if (!info.exists || info.isDirectory) continue;
      const target = legacyDocumentUri(legacyId, model);
      const complete = info.size >= model.sizeBytes * LEGACY_CACHE_MIN_FRACTION;
      const targetInfo = await LegacyFileSystem.getInfoAsync(target);
      if (complete && !targetInfo.exists) {
        const dir = new Directory(`${Paths.document.uri}models/${legacyId}/`);
        if (!dir.exists) dir.create({ intermediates: true });
        await LegacyFileSystem.moveAsync({ from: cacheUri, to: target });
      } else {
        await LegacyFileSystem.deleteAsync(cacheUri, { idempotent: true });
      }
    } catch (err) {
      console.warn("[aiModelService] legacy cache migration failed", err);
    }
  }
}

async function migrateLegacyState(): Promise<void> {
  await migrateLegacyCacheFiles();

  // Old partial downloads came from an unpinned revision; drop them and their resume data.
  const rawDownload = storage.getString(AI_DOWNLOAD_STATE_KEY);
  if (rawDownload) {
    try {
      const persisted = JSON.parse(rawDownload) as { modelId?: string };
      if (persisted.modelId && persisted.modelId in LEGACY_MODEL_IDS) storage.remove(AI_DOWNLOAD_STATE_KEY);
    } catch {
      storage.remove(AI_DOWNLOAD_STATE_KEY);
    }
  }
  for (const { legacyId, model } of legacyEntries()) {
    await deleteModelFile(`${legacyDocumentUri(legacyId, model)}.part`);
  }

  if (!storage.getString(ACTIVE_MODEL_KEY)) {
    const preferred = [LEGACY_ACTIVE_ID_KEY, LEGACY_DOWNLOADED_ID_KEY, LEGACY_SELECTED_ID_KEY]
      .map((key) => storage.getString(key))
      .filter((id): id is string => !!id && id in LEGACY_MODEL_IDS);
    const files = await aiModelService.findLegacyModelFiles();
    const chosen =
      preferred.map((id) => files.find((f) => f.model.id === LEGACY_MODEL_IDS[id])).find(Boolean) ?? files[0];
    if (chosen) {
      const size = (await modelFileSize(chosen.uri)) ?? 0;
      aiModelService.setActiveRecord({ id: chosen.model.id, path: chosen.uri, size, verifiedKey: null });
    }
  }
  storage.remove(LEGACY_ACTIVE_ID_KEY);
  storage.remove(LEGACY_DOWNLOADED_ID_KEY);
  storage.remove(LEGACY_SELECTED_ID_KEY);
}

export const aiModelService = {
  getContextWindowPlan(model: AiModel): ContextWindowPlan {
    const availableMemoryBytes = memoryInfo.getAvailableMemoryBytes();
    return {
      tokens: contextWindowFor(model, availableMemoryBytes),
      availableMemoryBytes,
    };
  },

  getDeviceProfile(): DeviceProfile {
    const totalRamGb = getTotalMemoryGb();
    const osVersion = getOsVersion();
    const osSupported =
      (Platform.OS === "ios" && osVersion >= 15) || (Platform.OS === "android" && osVersion >= 26);
    return { totalRamGb, osSupported };
  },

  /** False when the device reports less RAM than the model needs; unknown RAM is allowed. */
  fitsDeviceMemory(model: AiModel): boolean {
    const totalMemoryGb = getTotalMemoryGb();
    return totalMemoryGb === 0 || totalMemoryGb >= model.minRamGb;
  },

  usesSystemDownloader(): boolean {
    return systemDownloader !== null;
  },

  getModelDownloadUrl(model: AiModel): string {
    return model.url;
  },

  verifiedKey(model: AiModel): string {
    return `${model.hfFilename}:${model.sha256}`;
  },

  /**
   * Where the model file lives. Android: DownloadManager's app-specific
   * external dir. Otherwise the documents dir (the cache dir is purgeable).
   */
  getLocalModelPath(model: AiModel): string {
    const nativeDir = nativeModelsDir();
    if (nativeDir) return `file://${nativeDir}/${model.hfFilename}`;
    return `${aiModelService.getLocalModelDir(model)}${model.hfFilename}`;
  },

  getLocalModelDir(model: AiModel): string {
    return `${Paths.document.uri}models/${model.id}/`;
  },

  async ensureModelDir(model: AiModel): Promise<void> {
    const dir = new Directory(aiModelService.getLocalModelDir(model));
    if (!dir.exists) {
      await dir.create({ intermediates: true });
    }
  },

  getPartialModelPath(model: AiModel): string {
    return `${aiModelService.getLocalModelDir(model)}${model.hfFilename}.part`;
  },

  /** Complete model files left by older builds (documents dir, legacy ids). */
  async findLegacyModelFiles(): Promise<LegacyModelFile[]> {
    const found: LegacyModelFile[] = [];
    for (const { legacyId, model } of legacyEntries()) {
      const uri = legacyDocumentUri(legacyId, model);
      if ((await modelFileSize(uri)) !== null) found.push({ model, uri });
    }
    return found;
  },

  allModelFileUris(): string[] {
    const uris = AI_MODELS.flatMap((model) => [
      aiModelService.getLocalModelPath(model),
      `${aiModelService.getLocalModelDir(model)}${model.hfFilename}`,
      aiModelService.getPartialModelPath(model),
    ]);
    for (const { legacyId, model } of legacyEntries()) {
      uris.push(legacyDocumentUri(legacyId, model), `${legacyDocumentUri(legacyId, model)}.part`);
    }
    return [...new Set(uris)];
  },

  /** Maps ids/files persisted by older builds. Runs once per launch. */
  migrateLegacyStorage(): Promise<void> {
    legacyMigration ??= migrateLegacyState().catch((err) => {
      console.warn("[aiModelService] legacy migration failed", err);
    });
    return legacyMigration;
  },

  getActiveRecord(): ActiveModelRecord | null {
    const raw = storage.getString(ACTIVE_MODEL_KEY);
    if (!raw) return null;
    try {
      const record = JSON.parse(raw) as ActiveModelRecord;
      const model = findModel(record.id);
      return model ? { ...record, id: model.id } : null;
    } catch {
      return null;
    }
  },

  setActiveRecord(record: ActiveModelRecord | null) {
    if (!record) {
      storage.remove(ACTIVE_MODEL_KEY);
      return;
    }
    storage.set(ACTIVE_MODEL_KEY, JSON.stringify(record));
  },

  getActiveModelId(): AiModelId | null {
    return aiModelService.getActiveRecord()?.id ?? null;
  },

  getActiveModel(): AiModel | null {
    return findModel(aiModelService.getActiveModelId());
  },

  getActiveModelPath(): string | null {
    return aiModelService.getActiveRecord()?.path ?? null;
  },
};
