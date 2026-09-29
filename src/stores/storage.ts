import { createMMKV, type MMKV } from "react-native-mmkv";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { StateStorage } from "zustand/middleware";
import { logger } from "@/services/logger";

const STORAGE_ID = "nomadsafe-main";
const KEY_NAME = "nomadsafe.mmkv-key";
const MIGRATED_NAME = "nomadsafe.mmkv-encrypted";

// Background tasks (live location) may run while the phone is locked.
const keyOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

function generateKey() {
  return Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Opens the main MMKV store encrypted with AES-256. The key lives in the
 * Android Keystore / iOS Keychain. Stores created before encryption shipped
 * are encrypted in place once, then a marker records the migration.
 */
function openStorage(): MMKV {
  try {
    const existingKey = SecureStore.getItem(KEY_NAME, keyOptions);
    if (existingKey && SecureStore.getItem(MIGRATED_NAME, keyOptions) === "1") {
      return createMMKV({ id: STORAGE_ID, encryptionKey: existingKey, encryptionType: "AES-256" });
    }

    const key = existingKey ?? generateKey();
    if (!existingKey) SecureStore.setItem(KEY_NAME, key, keyOptions);
    const store = createMMKV({ id: STORAGE_ID });
    store.encrypt(key, "AES-256");
    SecureStore.setItem(MIGRATED_NAME, "1", keyOptions);
    return store;
  } catch (error) {
    // Deferred: logging loads analytics, which imports this module.
    queueMicrotask(() => logger.warn("storage", "encryption unavailable, using plain MMKV", error));
    return createMMKV({ id: STORAGE_ID });
  }
}

export const storage = openStorage();

export const mmkvStateStorage: StateStorage = {
  getItem: (name: string) => storage.getString(name) ?? null,
  setItem: (name: string, value: string) => storage.set(name, value),
  removeItem: (name: string) => storage.remove(name),
};
