import { requireOptionalNativeModule } from "expo-modules-core";

interface ExpoFrameRateModule {
  setHighFrameRate(high: boolean): void;
  setRecentsPreviewHidden?(hidden: boolean): void;
}

// Android only; null on iOS (ProMotion needs no request) and on builds without the module.
const nativeModule = requireOptionalNativeModule<ExpoFrameRateModule>("ExpoFrameRate");

/** Asks an adaptive-refresh screen for its top rate (e.g. 120 Hz) while a fast animation runs. */
export function setHighFrameRate(high: boolean) {
  try {
    nativeModule?.setHighFrameRate(high);
  } catch {
    // Older native builds: keep the system's choice.
  }
}

/** Android 13+: shows a blank card instead of the app's screenshot in the recents screen (used while the app lock is on). */
export function setRecentsPreviewHidden(hidden: boolean) {
  try {
    nativeModule?.setRecentsPreviewHidden?.(hidden);
  } catch {
    // Older native builds hide it always (they were built with the old config plugin).
  }
}
