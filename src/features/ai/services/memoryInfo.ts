import { requireOptionalNativeModule } from "expo-modules-core";

interface ExpoMemoryInfoModule {
  getAvailableMemoryBytes(): number;
}

const nativeModule = requireOptionalNativeModule<ExpoMemoryInfoModule>("ExpoMemoryInfo");

export const memoryInfo = {
  getAvailableMemoryBytes(): number | null {
    if (!nativeModule) return null;
    const available = nativeModule.getAvailableMemoryBytes();
    return Number.isFinite(available) && available > 0 ? available : null;
  },
};
