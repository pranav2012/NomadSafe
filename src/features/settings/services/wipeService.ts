import { secureStorage } from "@/features/auth/services/secureStorage";
import { pinAttempts } from "@/features/auth/services/pinAttempts";
import { useAuthStore } from "@/features/auth/store/authStore";
import { localModelService } from "@/features/ai/services/localModelService";
import { wipeModels } from "@/features/ai/services/modelProvisioner";
import { useChatStore } from "@/features/ai/store/chatStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { clearItinerarySyncCheckpoints } from "@/features/itinerary";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { resetBackgroundDisclosure } from "@/features/location-sharing/components/BackgroundLocationDisclosure";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { useSafetyStore } from "@/features/safety/store/safetyStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { useSharingStore } from "@/features/location-sharing/store/sharingStore";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { signOutAndCleanup } from "@/services/session";
import { storage } from "@/stores/storage";

async function attempt(step: () => unknown) {
  try {
    await step();
  } catch {}
}

/**
 * Wipes all on-device NomadSafe data after the user has confirmed and
 * authenticated in the UI. Each step is best-effort so one failure can't
 * leave the rest of the data behind; MMKV is cleared last.
 */
export async function wipeAllDeviceData(): Promise<void> {
  await signOutAndCleanup();

  await attempt(() => localModelService.stopChat());
  await attempt(() => localModelService.release());
  await attempt(wipeModels);

  useAuthStore.getState().setPinSet(false);
  useAuthStore.getState().setBiometricEnabled(false);
  useSettingsStore.getState().reset();
  useTripsStore.getState().reset();
  useExpensesStore.getState().reset();
  useEventsStore.getState().reset();
  useSafetyStore.getState().reset();
  useSharingStore.getState().reset();
  useChatStore.getState().reset();

  emergencyContactsStorage.clear();
  resetBackgroundDisclosure();
  await attempt(clearItinerarySyncCheckpoints);
  await attempt(() => secureStorage.resetPin());
  await attempt(() => pinAttempts.reset());

  storage.clearAll();
}
