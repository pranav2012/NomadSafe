// No React Native imports: node tests bundle this file directly.

export type AiModelId = "lite" | "base";

export interface AiModel {
  id: AiModelId;
  name: string;
  sizeMb: number;
  sizeBytes: number;
  minRamGb: number;
  hfRepoId: string;
  hfFilename: string;
  revision: string;
  sha256: string;
  quantLabel: string;
  url: string;
}

const MB = 1024 * 1024;
export const GB = 1024 * MB;
export const STORAGE_HEADROOM_BYTES = GB;

function defineModel(
  model: Omit<AiModel, "sizeMb" | "url" | "quantLabel">,
): AiModel {
  return {
    ...model,
    sizeMb: model.sizeBytes / MB,
    quantLabel: "Q4_K_M",
    url: `https://huggingface.co/${model.hfRepoId}/resolve/${model.revision}/${model.hfFilename}`,
  };
}

// Qwen 3.5 GGUFs (bartowski mirror), smallest first. Ids name the files on disk, so they stay put
// when display names change: the 0.8B is "NomadBase" and the 2B "NomadPro".
export const AI_MODELS: readonly AiModel[] = [
  defineModel({
    id: "lite",
    name: "NomadBase",
    sizeBytes: 579615840,
    minRamGb: 3,
    hfRepoId: "bartowski/Qwen_Qwen3.5-0.8B-GGUF",
    hfFilename: "Qwen_Qwen3.5-0.8B-Q4_K_M.gguf",
    revision: "f36b1ea49a332ede8fe5f389bbf5b3575ef71f48",
    sha256: "fb044e93939a70469c905781334f5de1e6c8b608ced6cbc8c9249bd4127d9526",
  }),
  defineModel({
    id: "base",
    name: "NomadPro",
    sizeBytes: 1396198496,
    minRamGb: 4,
    hfRepoId: "bartowski/Qwen_Qwen3.5-2B-GGUF",
    hfFilename: "Qwen_Qwen3.5-2B-Q4_K_M.gguf",
    revision: "7d26695454df6de5fbcce2e58681e62dae06ce43",
    sha256: "57a1085840f497d764a7fc5d346922dbde961efb54cc792ea81d694fd846a1d8",
  }),
];

/** Ids persisted by older builds, mapped to the model with the same file. */
export const LEGACY_MODEL_IDS: Readonly<Record<string, AiModelId>> = {
  compact: "lite",
};

/**
 * Models no longer offered (the 4B was too slow on phones). Devices that downloaded one delete it;
 * `ids` are the per-model folders it may sit in under current and legacy ids.
 */
export const RETIRED_MODEL_FILES: readonly { ids: readonly string[]; hfFilename: string }[] = [
  { ids: ["pro", "balanced"], hfFilename: "Qwen_Qwen3.5-4B-Q4_K_M.gguf" },
];

export function findModel(id: string | null | undefined): AiModel | null {
  if (!id) return null;
  const mapped = LEGACY_MODEL_IDS[id] ?? id;
  return AI_MODELS.find((m) => m.id === mapped) ?? null;
}

export type ModelPickReason = "ok" | "unsupportedDevice" | "insufficientStorage";

export interface ModelPick {
  model: AiModel | null;
  reason: ModelPickReason;
  downgraded: boolean;
}

export interface DeviceProfileInput {
  totalRamGb: number;
  /** Free bytes on the model volume; null/non-positive = unknown (assume it fits). */
  freeBytes: number | null;
  /** Bytes of each model already on disk (complete or partial), credited against its size. */
  presentBytes?: Partial<Record<AiModelId, number>>;
}

/**
 * Picks the largest model the RAM tier allows (<3 GB none, 3 lite, 4+ base),
 * then drops one tier at a time until it fits in free storage with
 * STORAGE_HEADROOM_BYTES to spare.
 */
export function pickModelForDevice({ totalRamGb, freeBytes, presentBytes }: DeviceProfileInput): ModelPick {
  const eligible = AI_MODELS.filter((m) => totalRamGb >= m.minRamGb);
  if (eligible.length === 0) return { model: null, reason: "unsupportedDevice", downgraded: false };

  const storageKnown = freeBytes !== null && Number.isFinite(freeBytes) && freeBytes > 0;
  for (let i = eligible.length - 1; i >= 0; i--) {
    const model = eligible[i];
    const credit = Math.min(presentBytes?.[model.id] ?? 0, model.sizeBytes);
    if (!storageKnown || (freeBytes as number) + credit >= model.sizeBytes + STORAGE_HEADROOM_BYTES) {
      return { model, reason: "ok", downgraded: i !== eligible.length - 1 };
    }
  }
  return { model: null, reason: "insufficientStorage", downgraded: false };
}

export function smallestModelForRam(totalRamGb: number): AiModel | null {
  return AI_MODELS.find((m) => totalRamGb >= m.minRamGb) ?? null;
}

/** Marketed RAM size from the OS-reported total, which is always a bit lower. */
export function nominalRamGb(totalBytes: number | null | undefined): number {
  if (typeof totalBytes !== "number" || !Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  return Math.ceil(totalBytes / GB - 0.05);
}
