import { AppState, DevSettings } from "react-native";
import { createMMKV, existsMMKV, type MMKV } from "react-native-mmkv";
import { createMockMMKV } from "react-native-mmkv/lib/createMMKV/createMockMMKV";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as Updates from "expo-updates";
import type { StateStorage } from "zustand/middleware";
import { logger } from "@/modules/logger";

const STORAGE_ID = "nomadsafe-main";
// Written only after the store is encrypted with it.
const KEY_NAME = "nomadsafe.mmkv-key.v2";
const LEGACY_KEY_NAME = "nomadsafe.mmkv-key";
const LEGACY_MIGRATED_NAME = "nomadsafe.mmkv-encrypted";
const READ_ATTEMPTS = 3;

// Background tasks (live location) may run while the phone is locked.
const keyOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

type KeyRead = { kind: "found"; value: string } | { kind: "missing" } | { kind: "error"; error: unknown };

class StorageUnavailableError extends Error {
  /** `secret` is the keychain item whose read failed, when that was the cause. */
  constructor(readonly reason: string, readonly cause?: unknown, readonly secret?: string) {
    super(reason);
    this.name = "StorageUnavailableError";
  }
}

function generateKey() {
  return Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads a keychain item, retrying errors; "missing" only when the keychain answered "not found". */
function readSecret(name: string): KeyRead {
  let lastError: unknown;
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    try {
      const value = SecureStore.getItem(name, keyOptions);
      return value ? { kind: "found", value } : { kind: "missing" };
    } catch (error) {
      lastError = error;
    }
  }
  return { kind: "error", error: lastError };
}

function valueOf(read: KeyRead, name: string): string | null {
  if (read.kind === "error") throw new StorageUnavailableError(`${name} unreadable`, read.error, name);
  return read.kind === "found" ? read.value : null;
}

/** Stores the key and reads it back, so data is never encrypted with a key that wasn't saved. */
function persistKey(name: string, key: string) {
  SecureStore.setItem(name, key, keyOptions);
  if (valueOf(readSecret(name), name) !== key) throw new StorageUnavailableError("key did not persist");
}

function forgetLegacyKey() {
  void SecureStore.deleteItemAsync(LEGACY_KEY_NAME).catch(() => {});
  void SecureStore.deleteItemAsync(LEGACY_MIGRATED_NAME).catch(() => {});
}

/**
 * Opens the main MMKV store encrypted with AES-256, keyed from the Android Keystore / iOS Keychain.
 * Throws instead of ever opening the encrypted file without its key or writing plaintext. A new key
 * is generated only when the keychain positively reports that none exists.
 */
function openEncrypted(): MMKV {
  const key = valueOf(readSecret(KEY_NAME), KEY_NAME);
  if (key) return createMMKV({ id: STORAGE_ID, encryptionKey: key, encryptionType: "AES-256" });

  const legacyKey = valueOf(readSecret(LEGACY_KEY_NAME), LEGACY_KEY_NAME);
  const legacyMigrated = valueOf(readSecret(LEGACY_MIGRATED_NAME), LEGACY_MIGRATED_NAME) === "1";

  if (legacyKey && legacyMigrated) {
    const store = createMMKV({ id: STORAGE_ID, encryptionKey: legacyKey, encryptionType: "AES-256" });
    persistKey(KEY_NAME, legacyKey);
    forgetLegacyKey();
    return store;
  }

  if (!legacyKey && !existsMMKV(STORAGE_ID)) {
    const fresh = generateKey();
    persistKey(KEY_NAME, fresh);
    return createMMKV({ id: STORAGE_ID, encryptionKey: fresh, encryptionType: "AES-256" });
  }

  // Plaintext store from before encryption: the key is saved before encrypting in place.
  const migrationKey = legacyKey ?? generateKey();
  if (!legacyKey) persistKey(LEGACY_KEY_NAME, migrationKey);
  const store = createMMKV({ id: STORAGE_ID });
  store.encrypt(migrationKey, "AES-256");
  SecureStore.setItem(LEGACY_MIGRATED_NAME, "1", keyOptions);
  persistKey(KEY_NAME, migrationKey);
  forgetLegacyKey();
  return store;
}

/**
 * Reloads the JS bundle once the keychain item that failed to read answers, so the real store opens.
 * Other failures (a key that won't save, MMKV not opening) wait for the next launch instead of looping.
 */
function watchForRecovery(secret: string) {
  let reloading = false;
  const tryRecover = () => {
    if (reloading || readSecret(secret).kind === "error") return;
    reloading = true;
    Updates.reloadAsync().catch(() => {
      if (__DEV__) DevSettings.reload();
      else reloading = false;
    });
  };
  AppState.addEventListener("change", (state) => {
    if (state === "active") tryRecover();
  });
  setTimeout(() => {
    if (AppState.currentState === "active") tryRecover();
  }, 2_000);
}

/**
 * Fails closed: if the key can't be read or saved (e.g. iOS before the first unlock after a reboot,
 * or a Keystore error), this session gets throwaway in-memory storage. The encrypted file is left
 * untouched and the app reloads into it once the unreadable item can be read.
 */
function openStorage(): { store: MMKV; persistent: boolean } {
  try {
    return { store: openEncrypted(), persistent: true };
  } catch (error) {
    const reason = error instanceof StorageUnavailableError ? error.reason : "mmkv open failed";
    // Deferred: logging loads analytics, which imports this module.
    queueMicrotask(() => logger.error("storage", "encrypted storage unavailable, using memory for this session", error, { reason }));
    if (error instanceof StorageUnavailableError && error.secret) watchForRecovery(error.secret);
    return { store: createMockMMKV({ id: `${STORAGE_ID}-memory` }), persistent: false };
  }
}

const opened = openStorage();

export const storage = opened.store;

/** False when this session fell back to in-memory storage. */
export const isStoragePersistent = opened.persistent;

export const mmkvStateStorage: StateStorage = {
  getItem: (name: string) => storage.getString(name) ?? null,
  setItem: (name: string, value: string) => storage.set(name, value),
  removeItem: (name: string) => storage.remove(name),
};

export { credentials, secureStore, type SecureStoreOptions } from "./secure";
