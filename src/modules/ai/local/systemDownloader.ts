import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

export type SystemDownloadStatus = "pending" | "running" | "paused" | "successful" | "failed" | "missing" | "unknown";

export interface SystemDownloadInfo {
  status: SystemDownloadStatus;
  reason: string | null;
  bytesDownloaded: number;
  totalBytes: number;
  localPath: string | null;
}

interface NativeModule {
  getModelsDirectory(): string;
  enqueue(url: string, fileName: string, title: string, description: string, wifiOnly: boolean): string;
  query(id: string): SystemDownloadInfo;
  remove(id: string): boolean;
  fileSize(path: string): Promise<number>;
  sha256(path: string): Promise<string>;
  deleteFile(path: string): Promise<boolean>;
}

const native = Platform.OS === "android" ? requireOptionalNativeModule<NativeModule>("ExpoSystemDownloader") : null;

/** Android system DownloadManager; `null` on iOS or when the native module isn't built in. */
export const systemDownloader = native;
