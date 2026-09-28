import { Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import type {
  DownloadPauseState,
  DownloadProgressData,
  FileSystemDownloadResult,
} from "expo-file-system/legacy";
import { storage } from "@/stores/storage";
import {
  aiModelService,
  AI_DOWNLOAD_STATE_KEY,
  findModel,
  modelFileSize,
  type AiModel,
} from "./aiModelService";

export type DownloadStatus =
  | "idle"
  | "downloading"
  | "paused"
  | "completed"
  | "error";

export type DownloadErrorCode =
  | "insufficientStorage"
  | "network"
  | "server"
  | "incomplete"
  | "unknown";

export interface DownloadState {
  modelId: string | null;
  status: DownloadStatus;
  progress: number;
  /** Raw diagnostic message (English); use errorCode for user-facing copy. */
  error: string | null;
  errorCode: DownloadErrorCode | null;
  /** True when paused on purpose rather than interrupted by a kill or network error. */
  pausedByUser: boolean;
}

interface PersistedDownload {
  modelId: string;
  status: DownloadStatus;
  progress: number;
  pausedByUser?: boolean;
  errorCode?: DownloadErrorCode | null;
  /** Serialized resumable so a download can be picked up after relaunch. */
  savable: DownloadPauseState | null;
}

const MB = 1024 * 1024;
const MIN_FREE_SPACE_MARGIN_BYTES = 300 * MB;

const IDLE_STATE: DownloadState = {
  modelId: null,
  status: "idle",
  progress: 0,
  error: null,
  errorCode: null,
  pausedByUser: false,
};

type Listener = (state: DownloadState) => void;

class DownloadError extends Error {
  constructor(
    readonly code: DownloadErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function clampPercent(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function readPersisted(): PersistedDownload | null {
  const raw = storage.getString(AI_DOWNLOAD_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedDownload;
  } catch {
    return null;
  }
}

function writePersisted(value: PersistedDownload | null) {
  if (!value) {
    storage.remove(AI_DOWNLOAD_STATE_KEY);
    return;
  }
  storage.set(AI_DOWNLOAD_STATE_KEY, JSON.stringify(value));
}

function header(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : null;
}

/** Full file size from Content-Range ("bytes a-b/total") or a 200 Content-Length. */
function expectedTotalBytes(result: FileSystemDownloadResult): number | null {
  const range = header(result.headers, "content-range");
  const rangeTotal = range ? Number(range.split("/")[1]) : NaN;
  if (Number.isFinite(rangeTotal) && rangeTotal > 0) return rangeTotal;
  if (result.status === 200) {
    const length = Number(header(result.headers, "content-length"));
    if (Number.isFinite(length) && length > 0) return length;
  }
  return null;
}

async function deleteQuietly(uri: string) {
  try {
    await LegacyFileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}

function hasFreeSpaceFor(bytesNeeded: number): boolean {
  try {
    const available = Paths.availableDiskSpace;
    if (!Number.isFinite(available) || available <= 0) return true;
    return available >= bytesNeeded + MIN_FREE_SPACE_MARGIN_BYTES;
  } catch {
    return true;
  }
}

class ModelDownloadManager {
  private listeners = new Set<Listener>();
  private resumable: LegacyFileSystem.DownloadResumable | null = null;
  private state: DownloadState = this.deriveInitialState();
  private starting = false;
  private progressExpectedBytes = 0;

  private deriveInitialState(): DownloadState {
    const persisted = readPersisted();
    if (!persisted) return { ...IDLE_STATE };
    // Legacy ids map to a new revision, so their resume data is unusable.
    if (findModel(persisted.modelId)?.id !== persisted.modelId) {
      writePersisted(null);
      return { ...IDLE_STATE };
    }
    return {
      modelId: persisted.modelId,
      // A persisted "downloading" status means the app was killed mid-download.
      status: persisted.status === "downloading" ? "paused" : persisted.status,
      progress: persisted.progress,
      error: null,
      errorCode: persisted.errorCode ?? null,
      pausedByUser: persisted.pausedByUser ?? false,
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
      pausedByUser: this.state.pausedByUser,
      errorCode: this.state.errorCode,
      savable,
    });
  }

  private onProgress = (data: DownloadProgressData) => {
    const total = data.totalBytesExpectedToWrite > 0 ? data.totalBytesExpectedToWrite : 0;
    this.progressExpectedBytes = Math.max(this.progressExpectedBytes, total);
    const percent = clampPercent(total > 0 ? (data.totalBytesWritten / total) * 100 : 0);
    if (percent !== this.state.progress) {
      this.emit({ progress: percent });
    }
  };

  private fail(model: AiModel, code: DownloadErrorCode, message: string) {
    this.emit({
      modelId: model.id,
      status: "error",
      error: message,
      errorCode: code,
      pausedByUser: false,
    });
  }

  private remainingBytes(model: AiModel): number {
    const total = model.sizeBytes;
    const done = this.state.modelId === model.id ? this.state.progress / 100 : 0;
    return Math.max(0, total * (1 - done));
  }

  /**
   * Begins a download for the given model. Resolves immediately if the file is
   * already complete, resumes a partial download for it, and ignores repeat
   * calls while a download is starting or running.
   */
  async start(model: AiModel): Promise<void> {
    if (this.starting || this.state.status === "downloading") return;
    this.starting = true;
    try {
      if (await isComplete(model)) {
        this.markCompleted(model);
        return;
      }

      const persisted = readPersisted();
      if (this.state.modelId === model.id && persisted?.savable?.resumeData) {
        this.starting = false;
        await this.resume();
        return;
      }

      if (!hasFreeSpaceFor(model.sizeBytes)) {
        this.fail(model, "insufficientStorage", "Not enough free storage for the model.");
        return;
      }

      await aiModelService.ensureModelDir(model);
      await deleteQuietly(aiModelService.getLocalModelPath(model));
      const partUri = aiModelService.getPartialModelPath(model);
      await deleteQuietly(partUri);

      this.progressExpectedBytes = 0;
      this.resumable = LegacyFileSystem.createDownloadResumable(
        aiModelService.getModelDownloadUrl(model),
        partUri,
        {},
        this.onProgress,
      );
      this.emit({
        modelId: model.id,
        status: "downloading",
        progress: 0,
        error: null,
        errorCode: null,
        pausedByUser: false,
      });
      this.persist(this.resumable.savable());
    } finally {
      this.starting = false;
    }
    if (this.getState().status === "downloading" && this.resumable) {
      const resumable = this.resumable;
      await this.runDownload(model, () => resumable.downloadAsync());
    }
  }

  /** Pauses the active download and stores resume data. */
  async pause(): Promise<void> {
    if (!this.resumable || this.state.status !== "downloading") return;
    this.emit({ status: "paused", pausedByUser: true });
    try {
      const savable = await this.resumable.pauseAsync();
      this.persist(savable);
    } catch (err) {
      this.emit({ status: "error", error: messageFrom(err), errorCode: "unknown", pausedByUser: false });
    }
  }

  /** Resumes a paused or failed download, reconstructing the task after a relaunch. */
  async resume(): Promise<void> {
    const model = this.currentModel();
    if (!model || this.starting || this.state.status === "downloading" || this.state.status === "completed") {
      return;
    }
    this.starting = true;
    try {
      if (await isComplete(model)) {
        this.markCompleted(model);
        return;
      }
      if (!hasFreeSpaceFor(this.remainingBytes(model))) {
        this.fail(model, "insufficientStorage", "Not enough free storage for the model.");
        return;
      }

      const partUri = aiModelService.getPartialModelPath(model);
      if (!this.resumable) {
        await aiModelService.ensureModelDir(model);
        const persisted = readPersisted();
        // Resume data recorded for an older file location can't be reused.
        const resumeData =
          persisted?.savable?.fileUri === partUri ? persisted.savable.resumeData : undefined;
        if (!resumeData) {
          await deleteQuietly(partUri);
          this.progressExpectedBytes = 0;
        }
        this.resumable = LegacyFileSystem.createDownloadResumable(
          aiModelService.getModelDownloadUrl(model),
          partUri,
          {},
          this.onProgress,
          resumeData,
        );
      }

      this.emit({ status: "downloading", error: null, errorCode: null, pausedByUser: false });
      this.persist(this.resumable.savable());
    } finally {
      this.starting = false;
    }
    if (this.getState().status === "downloading" && this.resumable) {
      const resumable = this.resumable;
      await this.runDownload(model, () => resumable.resumeAsync());
    }
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
      await deleteQuietly(aiModelService.getPartialModelPath(model));
    }
    this.resumable = null;
    writePersisted(null);
    this.emit({ ...IDLE_STATE });
  }

  private async runDownload(
    model: AiModel,
    run: () => Promise<FileSystemDownloadResult | undefined>,
  ): Promise<void> {
    let result: FileSystemDownloadResult | undefined;
    try {
      result = await run();
    } catch (err) {
      // A user-initiated pause surfaces as a rejection we can safely ignore.
      if (this.state.status === "paused" || this.state.status === "idle") return;
      this.fail(model, "network", messageFrom(err));
      this.persist(this.resumable?.savable() ?? null);
      return;
    }

    if (!result) return;

    try {
      await this.finalize(model, result);
    } catch (err) {
      this.resumable = null;
      await deleteQuietly(aiModelService.getPartialModelPath(model));
      const code = err instanceof DownloadError ? err.code : "unknown";
      this.fail(model, code, messageFrom(err));
      this.persist(null);
    }
  }

  /** Verifies HTTP status and exact size of the .part file, then moves it into place. */
  private async finalize(model: AiModel, result: FileSystemDownloadResult) {
    if (result.status !== 200 && result.status !== 206) {
      throw new DownloadError("server", `Download failed with HTTP ${result.status}.`);
    }
    const partUri = aiModelService.getPartialModelPath(model);
    const size = await modelFileSize(partUri);
    if (size !== model.sizeBytes) {
      const served = expectedTotalBytes(result) ?? (this.progressExpectedBytes || "?");
      throw new DownloadError("incomplete", `Downloaded ${size ?? 0} bytes, expected ${model.sizeBytes} (server: ${served}).`);
    }

    const finalUri = aiModelService.getLocalModelPath(model);
    await deleteQuietly(finalUri);
    await LegacyFileSystem.moveAsync({ from: partUri, to: finalUri });
    this.markCompleted(model);
  }

  private markCompleted(model: AiModel) {
    this.resumable = null;
    writePersisted(null);
    this.emit({
      modelId: model.id,
      status: "completed",
      progress: 100,
      error: null,
      errorCode: null,
      pausedByUser: false,
    });
  }

  private currentModel(): AiModel | null {
    return findModel(this.state.modelId);
  }
}

async function isComplete(model: AiModel): Promise<boolean> {
  return (await modelFileSize(aiModelService.getLocalModelPath(model))) === model.sizeBytes;
}

function messageFrom(err: unknown): string {
  return err instanceof Error ? err.message : "Download failed";
}

export const modelDownloadManager = new ModelDownloadManager();
