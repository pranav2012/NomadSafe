import { requireOptionalNativeModule } from "expo-modules-core";

interface ExpoFrameRateModule {
  setHighFrameRate(high: boolean): void;
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
