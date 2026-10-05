import { requireOptionalNativeModule } from "expo-modules-core";

interface ExpoBootClockModule {
  getElapsedSinceBootMs(): number;
}

const nativeModule = requireOptionalNativeModule<ExpoBootClockModule>("ExpoBootClock");

/** Milliseconds since boot, counting sleep (modules/expo-boot-clock); null when unavailable. */
export function elapsedSinceBootMs(): number | null {
  if (!nativeModule) return null;
  try {
    const value = nativeModule.getElapsedSinceBootMs();
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}
