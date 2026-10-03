import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { ensureProvisioned, useProvisioningStore, type ProvisionPhase } from "./modelProvisioner";

export const MODEL_DOWNLOAD_TASK = "nomadsafe-model-download";

// Defined at module load so the OS can dispatch it after a relaunch. During an
// OS-granted background window we move provisioning forward (resume / verify).
TaskManager.defineTask(MODEL_DOWNLOAD_TASK, async () => {
  try {
    await ensureProvisioned();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Phases where an OS background window can move a download forward, and ones where it never can.
const PENDING_PHASES: ReadonlySet<ProvisionPhase> = new Set(["queued", "downloading", "waitingForWifi", "verifying"]);
const SETTLED_PHASES: ReadonlySet<ProvisionPhase> = new Set(["ready", "disabled", "unsupportedDevice", "removed"]);

let syncing = false;

/**
 * Keeps the background task registered only while a download is pending, so the OS stops waking
 * the app every 15 minutes once the model is ready or local AI is off.
 */
export function registerModelDownloadTask(): void {
  if (syncing) return;
  syncing = true;
  const apply = (phase: ProvisionPhase) => {
    if (PENDING_PHASES.has(phase)) void registerTask();
    else if (SETTLED_PHASES.has(phase)) void unregisterTask();
  };
  apply(useProvisioningStore.getState().phase);
  useProvisioningStore.subscribe((state, prev) => {
    if (state.phase !== prev.phase) apply(state.phase);
  });
}

async function unregisterTask(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(MODEL_DOWNLOAD_TASK)) {
      await BackgroundTask.unregisterTaskAsync(MODEL_DOWNLOAD_TASK);
    }
  } catch {}
}

async function registerTask(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
    const registered = await TaskManager.isTaskRegisteredAsync(MODEL_DOWNLOAD_TASK);
    if (!registered) {
      await BackgroundTask.registerTaskAsync(MODEL_DOWNLOAD_TASK, {
        minimumInterval: 15,
      });
    }
  } catch {
    // Background execution is unavailable (e.g. simulator) — downloads still
    // resume when the app is reopened.
  }
}
