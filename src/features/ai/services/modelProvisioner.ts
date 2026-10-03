import { AppState } from "react-native";
import { Paths } from "expo-file-system";
import * as Network from "expo-network";
import { create } from "zustand";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { translate } from "@/localization/translate";
import { storage } from "@/stores/storage";
import {
  aiModelService,
  deleteModelFile,
  findModel,
  modelFileSize,
  pickModelForDevice,
  smallestModelForRam,
  STORAGE_HEADROOM_BYTES,
  toNativePath,
  type AiModel,
  type AiModelId,
} from "./aiModelService";
import { localModelService } from "./localModelService";
import { modelDownloadManager, type DownloadState } from "./modelDownloadManager";
import { modelNotifications } from "./modelNotifications";
import { systemDownloader, type SystemDownloadInfo } from "./systemDownloader";
import { logger } from "@/services/logger";

export type ProvisionPhase =
  | "checking"
  | "unsupportedDevice"
  | "disabled"
  | "insufficientStorage"
  | "waitingForWifi"
  | "queued"
  | "downloading"
  | "verifying"
  | "ready"
  | "removed"
  | "error";

export type ProvisionErrorCode =
  | "network"
  | "server"
  | "incomplete"
  | "corrupt"
  | "storageUnavailable"
  | "unknown";

export interface ProvisioningState {
  phase: ProvisionPhase;
  /** Model matched to this device (what is or will be downloaded). */
  model: AiModel | null;
  /** Model usable for inference right now; may be an older one while the target downloads. */
  activeModelId: AiModelId | null;
  progress: number;
  bytesDownloaded: number;
  errorCode: ProvisionErrorCode | null;
  allowMobileData: boolean;
  downgraded: boolean;
  deviceSupported: boolean | null;
  totalRamGb: number;
  requiredFreeBytes: number;
}

interface ProvisionRecord {
  modelId: AiModelId | null;
  downloadId: string | null;
  allowMobileData: boolean;
  phase: ProvisionPhase;
  userRemoved: boolean;
  errorCode: ProvisionErrorCode | null;
  autoRetries: number;
}

interface NetworkInfo {
  connected: boolean;
  wifi: boolean;
}

const RECORD_KEY = "ai-provision";
// `${path}:${size}` of old-build files whose hash didn't match, so they aren't re-hashed every launch.
const REJECTED_KEY = "ai-provision-rejected";
const POLL_INTERVAL_MS = 1500;
const JS_RETRY_BACKOFF_MS = 30_000;
// Failures that may be transient get this many silent retries before the error card shows.
const AUTO_RETRY_LIMIT = 2;
const AUTO_RETRYABLE: ReadonlySet<ProvisionErrorCode> = new Set(["incomplete", "corrupt", "network", "unknown"]);
// waitingForWifi isn't polled: nothing changes until the network does, and the network listener handles that.
const POLLED_PHASES: ReadonlySet<ProvisionPhase> = new Set(["queued", "downloading"]);

const DEFAULT_RECORD: ProvisionRecord = {
  modelId: null,
  downloadId: null,
  allowMobileData: false,
  phase: "checking",
  userRemoved: false,
  errorCode: null,
  autoRetries: 0,
};

function readRecord(): ProvisionRecord {
  const raw = storage.getString(RECORD_KEY);
  if (!raw) return { ...DEFAULT_RECORD };
  try {
    const parsed = { ...DEFAULT_RECORD, ...(JSON.parse(raw) as Partial<ProvisionRecord>) };
    return { ...parsed, modelId: findModel(parsed.modelId)?.id ?? null };
  } catch {
    return { ...DEFAULT_RECORD };
  }
}

function writeRecord(patch: Partial<ProvisionRecord>): ProvisionRecord {
  const next = { ...readRecord(), ...patch };
  storage.set(RECORD_KEY, JSON.stringify(next));
  return next;
}

function initialState(): ProvisioningState {
  const record = readRecord();
  return {
    phase: record.phase === "verifying" ? "checking" : record.phase,
    model: findModel(record.modelId),
    activeModelId: aiModelService.getActiveModelId(),
    progress: 0,
    bytesDownloaded: 0,
    errorCode: record.errorCode,
    allowMobileData: record.allowMobileData,
    downgraded: false,
    deviceSupported: null,
    totalRamGb: 0,
    requiredFreeBytes: 0,
  };
}

export const useProvisioningStore = create<ProvisioningState>()(() => initialState());

function patch(next: Partial<ProvisioningState>) {
  const prevPhase = useProvisioningStore.getState().phase;
  useProvisioningStore.setState(next);
  if (next.phase && next.phase !== prevPhase) {
    writeRecord({ phase: next.phase });
    schedulePolling();
  }
}

function readRejected(): string[] {
  try {
    return JSON.parse(storage.getString(REJECTED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function freeBytes(): number | null {
  try {
    const available = Paths.availableDiskSpace;
    return Number.isFinite(available) && available > 0 ? available : null;
  } catch {
    return null;
  }
}

async function readNetwork(): Promise<NetworkInfo> {
  try {
    const state = await Network.getNetworkStateAsync();
    const wifi =
      state.type === Network.NetworkStateType.WIFI || state.type === Network.NetworkStateType.ETHERNET;
    return { connected: state.isConnected !== false, wifi: wifi && state.isConnected !== false };
  } catch {
    return { connected: true, wifi: false };
  }
}

function samePath(a: string, b: string): boolean {
  return toNativePath(a) === toNativePath(b);
}

function isJsDownloadFor(model: AiModel, state: DownloadState = modelDownloadManager.getState()): boolean {
  return state.modelId === model.id && state.status !== "idle";
}

/** Drops the active record when its file is gone, or deletes a verified file whose size changed. */
async function validActiveRecord() {
  const active = aiModelService.getActiveRecord();
  if (!active) return null;
  const size = await modelFileSize(active.path);
  if (size === null) {
    aiModelService.setActiveRecord(null);
    return null;
  }
  if (size === active.size) return active;
  if (active.verifiedKey) {
    await localModelService.release();
    await deleteModelFile(active.path);
    aiModelService.setActiveRecord(null);
    return null;
  }
  const updated = { ...active, size };
  aiModelService.setActiveRecord(updated);
  return updated;
}

async function cancelDownload(record: ProvisionRecord) {
  if (record.downloadId && systemDownloader) {
    try {
      systemDownloader.remove(record.downloadId);
    } catch {}
  }
  if (!systemDownloader) {
    const { status } = modelDownloadManager.getState();
    if (status !== "idle" && status !== "completed") await modelDownloadManager.cancel();
  }
  if (record.downloadId) writeRecord({ downloadId: null });
}

async function deleteSuperseded(keepUri: string) {
  for (const uri of aiModelService.allModelFileUris()) {
    if (!samePath(uri, keepUri)) await deleteModelFile(uri);
  }
}

async function finishReady(model: AiModel, uri: string, opts: { notify: boolean }) {
  const previous = aiModelService.getActiveRecord();
  if (!previous || !samePath(previous.path, uri)) await localModelService.release();
  aiModelService.setActiveRecord({
    id: model.id,
    path: uri,
    size: model.sizeBytes,
    verifiedKey: aiModelService.verifiedKey(model),
  });
  // Mobile-data consent covered this download only.
  writeRecord({ modelId: model.id, downloadId: null, errorCode: null, allowMobileData: false, autoRetries: 0 });
  const jsState = modelDownloadManager.getState();
  if (jsState.status !== "idle" && jsState.status !== "downloading") await modelDownloadManager.cancel();
  await deleteSuperseded(uri);
  patch({
    phase: "ready",
    model,
    activeModelId: model.id,
    progress: 1,
    bytesDownloaded: model.sizeBytes,
    errorCode: null,
    allowMobileData: false,
  });
  if (opts.notify) await modelNotifications.notifyModelReady(model.name).catch(() => undefined);
}

function fail(code: ProvisionErrorCode) {
  writeRecord({ downloadId: null, errorCode: code });
  patch({ phase: "error", errorCode: code });
}

/**
 * Checks exact size, then SHA-256 natively on Android (iOS has no streaming
 * file hash, so the exact size is the check there).
 */
async function verifyFile(model: AiModel, uri: string): Promise<"ok" | "incomplete" | "corrupt"> {
  patch({ phase: "verifying", progress: 1 });
  const size = await modelFileSize(uri);
  if (size !== model.sizeBytes) return "incomplete";
  if (!systemDownloader) return "ok";
  try {
    const hash = await systemDownloader.sha256(toNativePath(uri));
    return hash.toLowerCase() === model.sha256 ? "ok" : "corrupt";
  } catch {
    return "incomplete";
  }
}

async function verifyDownloaded(model: AiModel, uri: string) {
  const result = await verifyFile(model, uri);
  if (result === "ok") {
    await finishReady(model, uri, { notify: true });
    return;
  }
  await deleteModelFile(uri);
  fail(result);
}

/**
 * Adopts a complete file for `model` already on disk: the canonical path
 * without a download record, the current active file, or an old-build file.
 */
async function tryAdoptExisting(model: AiModel, activePath: string | null): Promise<boolean> {
  const legacy = (await aiModelService.findLegacyModelFiles()).filter((f) => f.model.id === model.id);
  const candidates = [aiModelService.getLocalModelPath(model), activePath, ...legacy.map((f) => f.uri)];
  const rejected = readRejected();
  const seen: string[] = [];
  for (const uri of candidates) {
    if (!uri || seen.some((s) => samePath(s, uri))) continue;
    seen.push(uri);
    const size = await modelFileSize(uri);
    if (size !== model.sizeBytes || rejected.includes(`${uri}:${size}`)) continue;
    const result = await verifyFile(model, uri);
    if (result === "ok") {
      await finishReady(model, uri, { notify: false });
      return true;
    }
    // Keep a mismatching old file: it may still be the interim model.
    storage.set(REJECTED_KEY, JSON.stringify([...rejected, `${uri}:${size}`]));
  }
  return false;
}

function nativeRetryableFailure(reason: string | null): ProvisionErrorCode {
  if (!reason) return "unknown";
  if (reason === "storageUnavailable") return "storageUnavailable";
  if (reason.startsWith("http")) return "server";
  // ERROR_HTTP_DATA_ERROR / ERROR_CANNOT_RESUME
  if (reason === "failed1004" || reason === "failed1008") return "network";
  return "unknown";
}

function waitingPhase(net: NetworkInfo, allowMobileData: boolean): ProvisionPhase {
  if (!net.connected) return "queued";
  return !net.wifi && !allowMobileData ? "waitingForWifi" : "queued";
}

/** Returns true when the evaluation should run again (the download entry vanished). */
async function driveNative(model: AiModel, record: ProvisionRecord): Promise<boolean> {
  const downloader = systemDownloader;
  if (!downloader) return false;
  let downloadId = record.modelId === model.id ? record.downloadId : null;
  const justEnqueued = !downloadId;
  if (!downloadId) {
    try {
      downloadId = downloader.enqueue(
        model.url,
        model.hfFilename,
        translate("aiTab.provision.systemTitle", { model: model.name }),
        translate("aiTab.provision.systemDescription"),
        !record.allowMobileData,
      );
    } catch (err) {
      logger.warn("modelProvisioner", "enqueue failed", err);
      writeRecord({ modelId: model.id });
      fail("storageUnavailable");
      return false;
    }
    record = writeRecord({ modelId: model.id, downloadId, errorCode: null });
  }

  let info: SystemDownloadInfo;
  try {
    info = downloader.query(downloadId);
  } catch {
    info = { status: "missing", reason: null, bytesDownloaded: 0, totalBytes: -1, localPath: null };
  }
  const bytes = Math.max(0, info.bytesDownloaded || 0);
  const progress = Math.min(1, bytes / model.sizeBytes);

  switch (info.status) {
    case "successful":
      // Don't remove() the entry: that deletes the file.
      writeRecord({ downloadId: null });
      await verifyDownloaded(model, aiModelService.getLocalModelPath(model));
      return false;
    case "failed": {
      try {
        downloader.remove(downloadId);
      } catch {}
      writeRecord({ downloadId: null });
      if (info.reason === "insufficientSpace") {
        patch({ phase: "insufficientStorage", requiredFreeBytes: model.sizeBytes + STORAGE_HEADROOM_BYTES });
        return false;
      }
      fail(nativeRetryableFailure(info.reason));
      return false;
    }
    case "missing":
      // Entry cleared outside the app (e.g. from the Downloads app); re-enqueue once.
      writeRecord({ downloadId: null });
      if (justEnqueued) patch({ phase: "queued" });
      return !justEnqueued;
    case "running":
      patch({ phase: "downloading", progress, bytesDownloaded: bytes, errorCode: null });
      return false;
    default: {
      const net = await readNetwork();
      const phase =
        info.reason === "queuedForWifi" && !record.allowMobileData
          ? "waitingForWifi"
          : waitingPhase(net, record.allowMobileData);
      patch({ phase, progress, bytesDownloaded: bytes, errorCode: null });
      return false;
    }
  }
}

let lastJsAutoRetry = 0;

async function driveJs(model: AiModel, record: ProvisionRecord): Promise<void> {
  let state = modelDownloadManager.getState();
  if (state.modelId && state.modelId !== model.id && state.status !== "idle") {
    await modelDownloadManager.cancel();
    state = modelDownloadManager.getState();
  }
  if (record.modelId !== model.id) writeRecord({ modelId: model.id });
  const progress = state.modelId === model.id ? state.progress / 100 : 0;
  const bytesDownloaded = Math.round(progress * model.sizeBytes);

  if (state.modelId === model.id && state.status === "completed") {
    await verifyDownloaded(model, aiModelService.getLocalModelPath(model));
    return;
  }
  if (state.modelId === model.id && state.status === "error") {
    const code = state.errorCode ?? "unknown";
    if (code === "server" || code === "incomplete" || code === "unknown") {
      fail(code);
      return;
    }
    if (code === "network" && Date.now() - lastJsAutoRetry < JS_RETRY_BACKOFF_MS) {
      patch({ phase: "queued", progress, bytesDownloaded });
      return;
    }
  }

  const net = await readNetwork();
  if (!net.connected || (!net.wifi && !record.allowMobileData)) {
    if (state.status === "downloading") await modelDownloadManager.pause();
    patch({ phase: waitingPhase(net, record.allowMobileData), progress, bytesDownloaded, errorCode: null });
    return;
  }
  if (state.status === "downloading") {
    patch({ phase: "downloading", progress, bytesDownloaded, errorCode: null });
    return;
  }

  if (state.status === "error") lastJsAutoRetry = Date.now();
  patch({ phase: "downloading", progress, bytesDownloaded, errorCode: null });
  // Not awaited: resolves only when the download ends; progress arrives via subscribe().
  const run = isJsDownloadFor(model, state) ? modelDownloadManager.resume() : modelDownloadManager.start(model);
  run.catch((err: unknown) => logger.warn("modelProvisioner", "JS download failed", err));
}

/** One pass of the state machine. Returns true when it should run again. */
async function evaluate(): Promise<boolean> {
  await aiModelService.migrateLegacyStorage();
  const profile = aiModelService.getDeviceProfile();
  const deviceSupported = profile.osSupported && smallestModelForRam(profile.totalRamGb) !== null;
  let record = readRecord();
  const active = await validActiveRecord();
  patch({
    deviceSupported,
    totalRamGb: profile.totalRamGb,
    allowMobileData: record.allowMobileData,
    activeModelId: active?.id ?? null,
  });

  if (!useSettingsStore.getState().localAiEnabled) {
    await cancelDownload(record);
    await localModelService.release();
    patch({ phase: "disabled", progress: 0, bytesDownloaded: 0 });
    return false;
  }
  if (!deviceSupported) {
    await cancelDownload(record);
    patch({ phase: "unsupportedDevice", model: null });
    return false;
  }

  // Credit bytes already on disk so a finished or in-flight download doesn't push itself out.
  const presentBytes: Partial<Record<AiModelId, number>> = {};
  if (active) presentBytes[active.id] = active.size;
  if (record.modelId) {
    let inFlight = 0;
    if (record.downloadId && systemDownloader) {
      try {
        inFlight = systemDownloader.query(record.downloadId).bytesDownloaded || 0;
      } catch {}
    } else {
      const js = modelDownloadManager.getState();
      if (js.modelId === record.modelId) inFlight = (js.progress / 100) * (findModel(js.modelId)?.sizeBytes ?? 0);
    }
    presentBytes[record.modelId] = (presentBytes[record.modelId] ?? 0) + inFlight;
  }
  const pick = pickModelForDevice({ totalRamGb: profile.totalRamGb, freeBytes: freeBytes(), presentBytes });
  // Never trade a verified model in the RAM tier for a smaller one (or none) because storage got tight.
  const activeModel = findModel(active?.id);
  const keepActive =
    !!active &&
    !!activeModel &&
    active.verifiedKey === aiModelService.verifiedKey(activeModel) &&
    activeModel.minRamGb <= profile.totalRamGb &&
    (!pick.model || pick.model.sizeBytes < activeModel.sizeBytes);
  const target = keepActive ? activeModel : pick.model;

  if (record.userRemoved) {
    patch({ phase: "removed", model: target ?? smallestModelForRam(profile.totalRamGb) });
    return false;
  }
  if (!target) {
    await cancelDownload(record);
    const smallest = smallestModelForRam(profile.totalRamGb);
    patch({
      phase: "insufficientStorage",
      model: smallest,
      downgraded: false,
      requiredFreeBytes: (smallest?.sizeBytes ?? 0) + STORAGE_HEADROOM_BYTES,
    });
    return false;
  }

  const model = target;
  patch({ model, downgraded: !keepActive && pick.downgraded });

  if (active && active.id === model.id && active.verifiedKey === aiModelService.verifiedKey(model)) {
    // Cleanup already ran when it became ready.
    if (useProvisioningStore.getState().phase !== "ready") await finishReady(model, active.path, { notify: false });
    return false;
  }

  if (record.modelId && record.modelId !== model.id) {
    await cancelDownload(record);
    record = writeRecord({ modelId: null, downloadId: null, errorCode: null });
  }

  const downloadInFlight = systemDownloader ? !!record.downloadId : isJsDownloadFor(model);
  if (!downloadInFlight && (await tryAdoptExisting(model, active?.id === model.id ? active.path : null))) {
    return false;
  }

  if (record.errorCode && record.modelId === model.id) {
    if (!AUTO_RETRYABLE.has(record.errorCode) || record.autoRetries >= AUTO_RETRY_LIMIT) {
      patch({ phase: "error", errorCode: record.errorCode });
      return false;
    }
    record = writeRecord({ errorCode: null, autoRetries: record.autoRetries + 1 });
    if (!systemDownloader && modelDownloadManager.getState().status === "error") await modelDownloadManager.cancel();
  }

  if (systemDownloader) return driveNative(model, record);
  await driveJs(model, record);
  return false;
}

let running: Promise<void> | null = null;
let rerun = false;
let initialized = false;
let subscribers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let appActive = AppState.currentState === "active";
let lastJsStatus = modelDownloadManager.getState().status;

function schedulePolling() {
  const shouldPoll =
    systemDownloader !== null &&
    subscribers > 0 &&
    appActive &&
    POLLED_PHASES.has(useProvisioningStore.getState().phase);
  if (shouldPoll && !pollTimer) {
    pollTimer = setInterval(() => void ensureProvisioned(), POLL_INTERVAL_MS);
  } else if (!shouldPoll && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function init() {
  if (initialized) return;
  initialized = true;
  AppState.addEventListener("change", (next) => {
    appActive = next === "active";
    schedulePolling();
  });
  // Android repeats identical network events; only a real connectivity change matters here.
  let lastNetKey = "";
  Network.addNetworkStateListener(({ isConnected, type }) => {
    const key = `${isConnected}:${type}`;
    if (key === lastNetKey) return;
    lastNetKey = key;
    void ensureProvisioned();
  });
  useSettingsStore.subscribe((state, prev) => {
    if (state.localAiEnabled !== prev.localAiEnabled) void ensureProvisioned();
  });
  localModelService.setMissingModelHandler(() => void ensureProvisioned());
  modelDownloadManager.subscribe((state) => {
    const statusChanged = state.status !== lastJsStatus;
    lastJsStatus = state.status;
    const { model, phase } = useProvisioningStore.getState();
    if (state.status === "downloading" && model && state.modelId === model.id && phase === "downloading") {
      const progress = state.progress / 100;
      if (progress !== useProvisioningStore.getState().progress) {
        patch({ progress, bytesDownloaded: Math.round(progress * model.sizeBytes) });
      }
    }
    if (statusChanged && (state.status === "completed" || state.status === "error")) void ensureProvisioned();
  });
}

/**
 * Idempotent entry point: computes the device-matched model and moves its
 * download/verification forward. Concurrent calls coalesce into one extra pass.
 */
export function ensureProvisioned(): Promise<void> {
  init();
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      let again = true;
      let passes = 0;
      while ((again || rerun) && passes < 4) {
        rerun = false;
        passes += 1;
        again = await evaluate();
      }
    } catch (err) {
      logger.warn("modelProvisioner", "evaluation failed", err);
      patch({ phase: "error", errorCode: "unknown" });
    } finally {
      running = null;
      schedulePolling();
    }
  })();
  return running;
}

/** Registers a UI subscriber; polling runs only while one exists and the app is in the foreground. */
export function subscribeProvisioning(): () => void {
  subscribers += 1;
  schedulePolling();
  return () => {
    subscribers -= 1;
    schedulePolling();
  };
}

/** User consent to download over mobile data. DownloadManager can't relax an enqueued request, so it's re-enqueued. */
export async function enableMobileData(): Promise<void> {
  const record = readRecord();
  if (record.downloadId && systemDownloader) {
    try {
      systemDownloader.remove(record.downloadId);
    } catch {}
  }
  writeRecord({ allowMobileData: true, downloadId: null });
  patch({ allowMobileData: true });
  await ensureProvisioned();
}

export async function retry(): Promise<void> {
  const record = readRecord();
  await cancelDownload(record);
  writeRecord({ errorCode: null, downloadId: null, autoRetries: 0 });
  patch({ errorCode: null, phase: "checking" });
  await ensureProvisioned();
}

/** Deletes the model and stops auto-download until downloadAgain(). */
export async function removeModel(): Promise<void> {
  await localModelService.release();
  await cancelDownload(readRecord());
  for (const uri of aiModelService.allModelFileUris()) await deleteModelFile(uri);
  aiModelService.setActiveRecord(null);
  writeRecord({ downloadId: null, errorCode: null, userRemoved: true, allowMobileData: false });
  patch({ activeModelId: null, progress: 0, bytesDownloaded: 0, errorCode: null });
  await ensureProvisioned();
}

export async function downloadAgain(): Promise<void> {
  writeRecord({ userRemoved: false, errorCode: null, autoRetries: 0 });
  patch({ phase: "checking" });
  await ensureProvisioned();
}

/** Cancels downloads and deletes every model file (Settings → wipe data). */
export async function wipeModels(): Promise<void> {
  await localModelService.release();
  await cancelDownload(readRecord());
  for (const uri of aiModelService.allModelFileUris()) await deleteModelFile(uri);
  aiModelService.setActiveRecord(null);
  storage.remove(RECORD_KEY);
  storage.remove(REJECTED_KEY);
  useProvisioningStore.setState(initialState());
}
