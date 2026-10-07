import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Keychain from "react-native-keychain";

export interface SecureStoreOptions {
  /** Readable after the first unlock since boot, so background tasks can use it while the phone is locked. */
  background?: boolean;
}

function nativeOptions(options?: SecureStoreOptions): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: options?.background
      ? SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
      : SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

/** Small secrets (tokens, API keys) in the Android Keystore / iOS Keychain. */
export const secureStore = {
  getItem: (key: string, options?: SecureStoreOptions) => SecureStore.getItem(key, nativeOptions(options)),
  setItem: (key: string, value: string, options?: SecureStoreOptions) => SecureStore.setItem(key, value, nativeOptions(options)),
  get: (key: string, options?: SecureStoreOptions) => SecureStore.getItemAsync(key, nativeOptions(options)),
  set: (key: string, value: string, options?: SecureStoreOptions) => SecureStore.setItemAsync(key, value, nativeOptions(options)),
  remove: (key: string, options?: SecureStoreOptions) => SecureStore.deleteItemAsync(key, nativeOptions(options)),

  /**
   * iOS keeps an existing item's accessibility class when its value is updated, so items saved
   * before a class change are re-added once. Returns the keys that couldn't be migrated.
   */
  async upgradeAccessibility(keys: string[], options?: SecureStoreOptions): Promise<string[]> {
    if (Platform.OS !== "ios") return [];
    const failed: string[] = [];
    for (const key of keys) {
      try {
        const value = await SecureStore.getItemAsync(key, nativeOptions(options));
        if (value === null) continue;
        await SecureStore.deleteItemAsync(key, nativeOptions(options));
        await SecureStore.setItemAsync(key, value, nativeOptions(options));
      } catch {
        failed.push(key);
      }
    }
    return failed;
  },
};

/** One credential per service in the platform keychain. Only read in the foreground. */
export const credentials = {
  async get(service: string): Promise<string | null> {
    const result = await Keychain.getGenericPassword({ service });
    return result ? result.password : null;
  },
  async set(service: string, value: string): Promise<void> {
    await Keychain.setGenericPassword(service, value, {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async remove(service: string): Promise<void> {
    await Keychain.resetGenericPassword({ service });
  },
};
