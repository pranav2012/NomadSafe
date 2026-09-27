import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSettingsStore } from "@/features/settings";
import { useLocalization } from "@/localization";
import {
  aiModelService,
  AI_MODELS,
  formatModelSize,
  type AiModel,
  type DeviceCapability,
} from "../services/aiModelService";
import { localModelService } from "../services/localModelService";
import {
  deleteDownloadedModel,
  modelDownloadManager,
  type DownloadErrorCode,
  type DownloadState,
} from "../services/modelDownloadManager";

export interface ModelListItem {
  model: AiModel;
  /** Model file exists on disk. */
  isDownloaded: boolean;
  /** Model is currently loaded in RAM and ready for inference. */
  isLoaded: boolean;
  /** Model is selected as the current default/active model. */
  isActive: boolean;
  /** Model can be downloaded on this device. */
  isAvailable: boolean;
  /** Device RAM is below the model's minimum; download and activation are blocked. */
  needsMoreRam: boolean;
  /** This is the tier assigned by device capability. */
  isRecommended: boolean;
  /** Download is currently running for this model. */
  isDownloading: boolean;
  /** Download is paused for this model. */
  isPaused: boolean;
  /** Progress 0-100 when downloading or paused. */
  progress: number;
  /** Local AI is globally disabled in Settings. */
  isAiDisabled: boolean;
}

export interface UseAiModelsResult {
  /** All Nomad models with their current local/download/load state. */
  models: ModelListItem[];
  /** Device capability for running local AI. */
  capability: DeviceCapability | null;
  /** Whether device capability is still being checked. */
  isChecking: boolean;
  /** Id of the model currently set as default in storage. */
  activeModelId: string | null;
  /** Error code of the last failed download, for localized copy. */
  downloadErrorCode: DownloadErrorCode | null;
  /** Format helper used by the UI. */
  formatSize: (sizeMb: number) => string;
  /** Whether local AI is globally disabled in Settings. */
  localAiEnabled: boolean;
  /** Set a downloaded model as the current default active model. */
  setDefaultModel: (model: AiModel) => void;
  /** Start downloading a model. */
  startDownload: (model: AiModel) => Promise<void>;
  /** Pause active download. */
  pauseDownload: () => Promise<void>;
  /** Resume active download. */
  resumeDownload: () => Promise<void>;
  /** Cancel active download and delete partial file. */
  cancelDownload: () => Promise<void>;
  /** Delete a downloaded model file from disk. */
  deleteModel: (model: AiModel) => Promise<void>;
}

// Device RAM/OS don't change at runtime, so capability is computed once.
let capabilityPromise: Promise<DeviceCapability> | null = null;
let cachedCapability: DeviceCapability | null = null;

function loadCapability(): Promise<DeviceCapability> {
  capabilityPromise ??= aiModelService.checkDeviceCapability().then((cap) => {
    cachedCapability = cap;
    return cap;
  });
  return capabilityPromise;
}

async function readDownloadedIds(): Promise<string> {
  const ids: string[] = [];
  for (const model of AI_MODELS) {
    if (await aiModelService.isModelDownloaded(model)) ids.push(model.id);
  }
  return ids.join(",");
}

/**
 * Reactive hook that surfaces the full local model inventory:
 * downloaded state, in-memory loaded state, active/default model,
 * download progress, and device capability. File state is refreshed on
 * download status changes, screen focus, and app foreground (no polling).
 */
export function useAiModels(): UseAiModelsResult {
  const { locale } = useLocalization();
  const [download, setDownload] = useState<DownloadState>(() =>
    modelDownloadManager.getState(),
  );
  const [capability, setCapability] = useState<DeviceCapability | null>(cachedCapability);
  const [activeModelId, setActiveModelId] = useState<string | null>(() =>
    aiModelService.getActiveModelId(),
  );
  // Comma-joined ids so unchanged refreshes keep the same state value.
  const [downloadedKey, setDownloadedKey] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(() =>
    localModelService.getActiveModelId(),
  );
  const localAiEnabled = useSettingsStore((s) => s.localAiEnabled);

  useEffect(() => modelDownloadManager.subscribe(setDownload), []);
  useEffect(() => localModelService.subscribeLoadedModel(setLoadedId), []);

  useEffect(() => {
    let mounted = true;
    loadCapability().then((cap) => {
      if (mounted) setCapability(cap);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const refreshFiles = useCallback(async () => {
    const key = await readDownloadedIds();
    setDownloadedKey(key);
    setActiveModelId(aiModelService.getActiveModelId());
  }, []);

  useEffect(() => {
    let mounted = true;
    readDownloadedIds().then((key) => {
      if (!mounted) return;
      setDownloadedKey(key);
      setActiveModelId(aiModelService.getActiveModelId());
    });
    return () => {
      mounted = false;
    };
  }, [download.status]);

  useFocusEffect(
    useCallback(() => {
      refreshFiles();
      setLoadedId(localModelService.getActiveModelId());
    }, [refreshFiles]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refreshFiles();
    });
    return () => subscription.remove();
  }, [refreshFiles]);

  const models = useMemo((): ModelListItem[] => {
    const downloadedIds = new Set(downloadedKey ? downloadedKey.split(",") : []);
    const availableIds = new Set(
      capability?.supported ? aiModelService.getAvailableModels(capability).map((m) => m.id) : [],
    );
    const recommendedId = capability?.assignedCategory ?? null;
    return AI_MODELS.map((model) => {
      const isDownloaded = downloadedIds.has(model.id);
      const isDownloading = download.modelId === model.id && download.status === "downloading";
      const isPaused = download.modelId === model.id && download.status === "paused";
      const isActive = activeModelId === model.id;
      return {
        model,
        isDownloaded,
        isLoaded: loadedId === model.id && isDownloaded && localAiEnabled,
        isActive,
        isAvailable: availableIds.has(model.id),
        needsMoreRam:
          capability !== null && capability.totalMemoryGb > 0 && capability.totalMemoryGb < model.minRamGb,
        isRecommended: recommendedId === model.id,
        isDownloading,
        isPaused,
        progress: download.modelId === model.id ? download.progress : 0,
        isAiDisabled: !localAiEnabled,
      };
    });
  }, [
    capability,
    downloadedKey,
    loadedId,
    activeModelId,
    download.modelId,
    download.status,
    download.progress,
    localAiEnabled,
  ]);

  const setDefaultModel = (model: AiModel) => {
    if (!aiModelService.fitsDeviceMemory(model)) return;
    localModelService.setDefaultModel(model);
    setActiveModelId(model.id);
  };

  const startDownload = async (model: AiModel) => {
    if (!aiModelService.fitsDeviceMemory(model)) return;
    // If already on disk, just promote to default.
    if (await aiModelService.isModelDownloaded(model)) {
      setDefaultModel(model);
      return;
    }
    await modelDownloadManager.start(model);
  };

  const deleteModel = async (model: AiModel) => {
    await deleteDownloadedModel(model);
    await refreshFiles();
  };

  return {
    models,
    capability,
    isChecking: capability === null,
    activeModelId,
    downloadErrorCode: download.status === "error" ? download.errorCode ?? "unknown" : null,
    formatSize: (sizeMb: number) => formatModelSize(sizeMb, locale),
    localAiEnabled,
    setDefaultModel,
    startDownload,
    pauseDownload: () => modelDownloadManager.pause(),
    resumeDownload: () => modelDownloadManager.resume(),
    cancelDownload: () => modelDownloadManager.cancel(),
    deleteModel,
  };
}
