import { aiModelService } from "./local/aiModelService";
import { localModelService } from "./local/localModelService";
import { registerModelDownloadTask } from "./local/modelDownloadTask";
import { ensureProvisioned, wipeModels } from "./local/modelProvisioner";

/** On-device model lifecycle for app code: warm-up, memory release, download provisioning and removal. */
export const aiRuntime = {
  /** Loads the downloaded model ahead of the first request; no-op when there is none. */
  preload: () => localModelService.preload(),
  /** Frees the loaded model's memory; deferred while a completion runs, so safe to call at any time. */
  release: () => localModelService.release(),
  /** Frees the model `delayMs` after current work, unless something uses it again first. */
  releaseAfter: (delayMs: number) => localModelService.releaseAfter(delayMs),
  ensureProvisioned,
  registerBackgroundDownload: registerModelDownloadTask,
  /** Deletes every downloaded model file. */
  wipeModels,
  provisionedModelId: () => aiModelService.getActiveModelId(),
  usesSystemDownloader: () => aiModelService.usesSystemDownloader(),
};
