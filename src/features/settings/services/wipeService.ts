import { authClient } from "@/features/auth";
import { secureStorage } from "@/features/auth/services/secureStorage";
import { localModelService } from "@/features/ai/services/localModelService";
import { useChatStore } from "@/features/ai/store/chatStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { useSafetyStore } from "@/features/safety/store/safetyStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { useSharingStore } from "@/features/location-sharing/store/sharingStore";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useAuthStore } from "@/features/auth/store/authStore";
import { storage } from "@/stores/storage";

/**
 * Wipes all on-device NomadSafe data after the user has already passed
 * biometric / PIN confirmation in the UI.
 *
 * Steps:
 * 1. Sign out of the Better Auth session (best-effort).
 * 2. Release any loaded local AI model.
 * 3. Reset every Zustand store to its initial state.
 * 4. Clear emergency contacts from raw MMKV.
 * 5. Delete the backup PIN from the keychain/keystore.
 * 6. Clear the MMKV database so persisted stores start fresh.
 *
 * Callers must confirm irreversibility and authenticate first.
 */
export async function wipeAllDeviceData(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // Ignore network/session errors; local wipe is what matters.
  }

  await localModelService.release();

  useAuthStore.getState().signOut();
  useSettingsStore.getState().reset();
  useTripsStore.getState().reset();
  useExpensesStore.getState().reset();
  useSafetyStore.getState().reset();
  useSharingStore.getState().reset();
  useChatStore.getState().reset();

  emergencyContactsStorage.clear();
  await secureStorage.resetPin();

  storage.clearAll();
}
