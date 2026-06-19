import * as LegacyFileSystem from "expo-file-system/legacy";
import type { DownloadPauseState, DownloadProgressData } from "expo-file-system/legacy";
import { storage } from "@/stores/storage";
import { aiModelService, AI_MODELS, type AiModel } from "./aiModelService";
import { modelNotifications } from "./modelNotifications";

export type DownloadStatus =
  | "idle"
  | "downloading"
  | "paused"
  | "completed"
  | "error";

export interface DownloadState {
  modelId: string | null;
  status: DownloadStatus;
  progress: number;
  error: string | null;
}

interface PersistedDownload {
  modelId: string;
  status: DownloadStatus;
  progress: number;
  /** Serialized resumable so a download can be picked up after relaunch. */
  savable: DownloadPauseState | null;
}

const DOWNLOAD_STATE_KEY = "ai-download-state";

const IDLE_STATE: DownloadState = {
  modelId: null,
  status: "idle",
  progress: 0,
  error: null,
};

type Listener = (state: DownloadState) => void;

function clampPercent(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function readPersisted(): PersistedDownload | null {
  const raw = storage.getString(DOWNLOAD_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedDownload;
  } catch {
    return null;
  }
}

function writePersisted(value: PersistedDownload | null) {
  if (!value) {
    storage.remove(DOWNLOAD_STATE_KEY);
    return;
  }
  storage.set(DOWNLOAD_STATE_KEY, JSON.stringify(value));
}

class ModelDownloadManager {
  private listeners = new Set<Listener>();
  private resumable: LegacyFileSystem.DownloadResumable | null = null;
  private state: DownloadState = this.deriveInitialState();

  private deriveInitialState(): DownloadState {
    const persisted = readPersisted();
    if (!persisted) return { ...IDLE_STATE };
    return {
      modelId: persisted.modelId,
      // A persisted "downloading" status means the app was killed mid-download.
      status: persisted.status === "downloading" ? "paused" : persisted.status,
      progress: persisted.progress,
      error: null,
    };
  }

  getState(): DownloadState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: Partial<DownloadState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l(this.state));
  }

  private persist(savable: DownloadPauseState | null) {
    if (!this.state.modelId || this.state.status === "idle") {
      writePersisted(null);
      return;
    }
    writePersisted({
      modelId: this.state.modelId,
      status: this.state.status,
      progress: this.state.progress,
      savable,
    });
  }

  private onProgress = (data: DownloadProgressData) => {
    const total =
      data.totalBytesExpectedToWrite > 0
        ? data.totalBytesExpectedToWrite
        : 0;
    const percent = total > 0 ? (data.totalBytesWritten / total) * 100 : 0;
    this.emit({ progress: clampPercent(percent) });
  };

  /**
   * Begins (or restarts) a download for the given model. If the model file is
   * already present locally, it resolves immediately without re-downloading.
   */
  async start(model: AiModel): Promise<void> {
    if (await aiModelService.isModelDownloaded(model)) {
      await this.markCompleted(model, { notify: false });
      return;
    }

    await aiModelService.ensureModelDir(model);
    const url = aiModelService.getModelDownloadUrl(model);
    const fileUri = aiModelService.getLocalModelPath(model);

    this.resumable = LegacyFileSystem.createDownloadResumable(
      url,
      fileUri,
      {},
      this.onProgress,
    );
    this.emit({ modelId: model.id, status: "downloading", progress: 0, error: null });
    this.persist(this.resumable.savable());
    await this.runDownload(model, () => this.resumable!.downloadAsync());
  }

  /** Pauses the active download and stores resume data. */
  async pause(): Promise<void> {
    if (!this.resumable || this.state.status !== "downloading") return;
    try {
      const savable = await this.resumable.pauseAsync();
      this.emit({ status: "paused" });
      this.persist(savable);
    } catch (err) {
      this.emit({ status: "error", error: messageFrom(err) });
    }
  }

  /** Resumes a paused download, reconstructing the task after a relaunch. */
  async resume(): Promise<void> {
    const model = this.currentModel();
    if (!model || this.state.status === "downloading" || this.state.status === "completed") {
      return;
    }
    if (await aiModelService.isModelDownloaded(model)) {
      await this.markCompleted(model, { notify: false });
      return;
    }

    if (!this.resumable) {
      const persisted = readPersisted();
      const fileUri = aiModelService.getLocalModelPath(model);
      this.resumable = LegacyFileSystem.createDownloadResumable(
        aiModelService.getModelDownloadUrl(model),
        fileUri,
        {},
        this.onProgress,
        persisted?.savable?.resumeData,
      );
    }

    this.emit({ status: "downloading", error: null });
    this.persist(this.resumable.savable());
    await this.runDownload(model, () => this.resumable!.resumeAsync());
  }

  /** Cancels and removes any partially downloaded file. */
  async cancel(): Promise<void> {
    try {
      await this.resumable?.cancelAsync();
    } catch {
      // ignore — the task may already be gone
    }
    const model = this.currentModel();
    if (model) {
      try {
        await LegacyFileSystem.deleteAsync(aiModelService.getLocalModelPath(model), {
          idempotent: true,
        });
      } catch {
        // ignore
      }
    }
    this.resumable = null;
    writePersisted(null);
    this.emit({ ...IDLE_STATE });
  }

  /**
   * Picks up an interrupted download on app launch / when returning to the
   * foreground. Safe to call repeatedly.
   */
  async resumeIfInterrupted(): Promise<void> {
    if (this.state.status === "paused" || this.state.status === "downloading") {
      await this.resume();
    }
  }

  private async runDownload(
    model: AiModel,
    run: () => Promise<unknown>,
  ): Promise<void> {
    try {
      const result = await run();
      // pauseAsync rejects the in-flight promise; a resolved result means done.
      if (result) {
        await this.markCompleted(model, { notify: true });
      }
    } catch (err) {
      // A user-initiated pause surfaces as a rejection we can safely ignore.
      if (this.state.status === "paused") return;
      this.emit({ status: "error", error: messageFrom(err) });
      this.persist(this.resumable?.savable() ?? null);
    }
  }

  private async markCompleted(model: AiModel, opts: { notify: boolean }) {
    this.resumable = null;
    aiModelService.setDownloadedModelId(model.id);
    writePersisted(null);
    this.emit({ modelId: model.id, status: "completed", progress: 100, error: null });
    if (opts.notify) {
      await modelNotifications.notifyModelReady(model.name);
    }
  }

  private currentModel(): AiModel | null {
    return AI_MODELS.find((m) => m.id === this.state.modelId) ?? null;
  }
}

function messageFrom(err: unknown): string {
  return err instanceof Error ? err.message : "Download failed";
}

export const modelDownloadManager = new ModelDownloadManager();
