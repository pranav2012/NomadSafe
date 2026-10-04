import * as SecureStore from "expo-secure-store";
import * as Keychain from "react-native-keychain";

export interface SecureStoreOptions {
  /** Readable after the first unlock since boot, so background tasks can use it while the phone is locked. */
  background?: boolean;
}

function nativeOptions(options?: SecureStoreOptions): SecureStore.SecureStoreOptions | undefined {
  return options?.background ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined;
}

/** Small secrets (tokens, API keys) in the Android Keystore / iOS Keychain. */
export const secureStore = {
  getItem: (key: string, options?: SecureStoreOptions) => SecureStore.getItem(key, nativeOptions(options)),
  setItem: (key: string, value: string, options?: SecureStoreOptions) => SecureStore.setItem(key, value, nativeOptions(options)),
  get: (key: string, options?: SecureStoreOptions) => SecureStore.getItemAsync(key, nativeOptions(options)),
  set: (key: string, value: string, options?: SecureStoreOptions) => SecureStore.setItemAsync(key, value, nativeOptions(options)),
  remove: (key: string, options?: SecureStoreOptions) => SecureStore.deleteItemAsync(key, nativeOptions(options)),
};

/** One credential per service in the platform keychain (the PIN hash lives here). */
export const credentials = {
  async get(service: string): Promise<string | null> {
    const result = await Keychain.getGenericPassword({ service });
    return result ? result.password : null;
  },
  async set(service: string, value: string): Promise<void> {
    await Keychain.setGenericPassword(service, value, { service });
  },
  async remove(service: string): Promise<void> {
    await Keychain.resetGenericPassword({ service });
  },
};
