import { useEffect, useMemo, useState } from "react";
import {
  aiModelService,
  AI_MODELS,
  formatModelSize,
  localModelService,
  modelDownloadManager,
  type AiModel,
  type DeviceCapability,
  type DownloadState,
} from "@/features/ai";

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
  /** This is the tier assigned by device capability. */
  isRecommended: boolean;
  /** Download is currently running for this model. */
  isDownloading: boolean;
  /** Download is paused for this model. */
  isPaused: boolean;
  /** Progress 0-100 when downloading or paused. */
  progress: number;
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
  /** Any active download error message. */
  downloadError: string | null;
  /** Format helper used by the UI. */
  formatSize: (sizeMb: number) => string;
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

/**
 * Reactive hook that surfaces the full local model inventory:
 * downloaded state, in-memory loaded state, active/default model,
 * download progress, and device capability.
 */
export function useAiModels(): UseAiModelsResult {
  const [download, setDownload] = useState<DownloadState>(() =>
    modelDownloadManager.getState(),
  );
  const [capability, setCapability] = useState<DeviceCapability | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [activeModelId, setActiveModelId] = useState<string | null>(() =>
    aiModelService.getActiveModelId(),
  );
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [loadedId, setLoadedId] = useState<string | null>(() =>
    localModelService.getActiveModelId(),
  );
  const [tick, setTick] = useState(0);

  // Subscribe to download manager updates and periodically recheck loaded model.
  useEffect(() => {
    const unsubscribe = modelDownloadManager.subscribe(setDownload);
    const interval = setInterval(() => {
      setLoadedId(localModelService.getActiveModelId());
      setTick((t) => t + 1);
    }, 500);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  // Check device capability and which models are on disk.
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const cap = await aiModelService.checkDeviceCapability();
      if (!mounted) return;
      setCapability(cap);
      setIsChecking(false);

      const active = aiModelService.getActiveModelId();
      setActiveModelId(active);

      const nextDownloaded = new Set<string>();
      for (const model of AI_MODELS) {
        if (await aiModelService.isModelDownloaded(model)) {
          nextDownloaded.add(model.id);
        }
      }
      if (mounted) setDownloadedIds(nextDownloaded);
    };
    run();
    return () => {
      mounted = false;
    };
  }, [tick, download.status]);

  const availableIds = useMemo(() => {
    if (!capability?.supported) return new Set<string>();
    return new Set(
      aiModelService.getAvailableModels(capability).map((m) => m.id),
    );
  }, [capability]);

  const models = useMemo((): ModelListItem[] => {
    const recommendedId = capability?.assignedCategory ?? null;
    return AI_MODELS.map((model) => {
      const isDownloaded = downloadedIds.has(model.id);
      const isDownloading = download.modelId === model.id && download.status === "downloading";
      const isPaused = download.modelId === model.id && download.status === "paused";
      const isActive = activeModelId === model.id;
      return {
        model,
        isDownloaded,
        isLoaded: loadedId === model.id && isDownloaded,
        isActive,
        isAvailable: availableIds.has(model.id),
        isRecommended: recommendedId === model.id,
        isDownloading,
        isPaused,
        progress: download.modelId === model.id ? download.progress : 0,
      };
    });
  }, [
    capability,
    downloadedIds,
    loadedId,
    activeModelId,
    availableIds,
    download.modelId,
    download.status,
    download.progress,
  ]);

  const setDefaultModel = (model: AiModel) => {
    localModelService.setDefaultModel(model);
    setActiveModelId(model.id);
  };

  const startDownload = async (model: AiModel) => {
    // If already on disk, just promote to default.
    if (await aiModelService.isModelDownloaded(model)) {
      setDefaultModel(model);
      return;
    }
    await modelDownloadManager.start(model);
  };

  const deleteModel = async (model: AiModel) => {
    const { deleteDownloadedModel } = await import(
      "../services/modelDownloadManager"
    );
    await deleteDownloadedModel(model);
    setTick((t) => t + 1);
    setActiveModelId(aiModelService.getActiveModelId());
  };

  return {
    models,
    capability,
    isChecking,
    activeModelId,
    downloadError: download.status === "error" ? download.error : null,
    formatSize: formatModelSize,
    setDefaultModel,
    startDownload,
    pauseDownload: () => modelDownloadManager.pause(),
    resumeDownload: () => modelDownloadManager.resume(),
    cancelDownload: () => modelDownloadManager.cancel(),
    deleteModel,
  };
}
