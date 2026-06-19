import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { modelDownloadManager } from "./modelDownloadManager";

export const MODEL_DOWNLOAD_TASK = "nomadsafe-model-download";

// Defined at module load so the OS can dispatch it after a relaunch. During an
// OS-granted background window we resume any interrupted model download.
TaskManager.defineTask(MODEL_DOWNLOAD_TASK, async () => {
  try {
    await modelDownloadManager.resumeIfInterrupted();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerModelDownloadTask(): Promise<void> {
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
