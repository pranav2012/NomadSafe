import { secureStorage } from "@/features/auth/services/secureStorage";
import { pinAttempts } from "@/features/auth/services/pinAttempts";
import { useAuthStore } from "@/features/auth/store/authStore";
import { localModelService } from "@/features/ai/services/localModelService";
import { aiService } from "@/features/ai/services/aiService";
import { clearByokConfig } from "@/features/ai/services/remote/byok";
import { clearCloudExhaustion } from "@/features/ai/services/remote/cloud";
import { usePlanStore } from "@/features/billing/store/planStore";
import { wipeModels } from "@/features/ai/services/modelProvisioner";
import { useChatStore } from "@/features/ai/store/chatStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { clearLegacyGmailCheckpoints } from "@/features/expenses/services/legacyGmailCheckpoints";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { resetBackgroundDisclosure } from "@/features/location-sharing/components/BackgroundLocationDisclosure";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { useSafetyStore } from "@/features/safety/store/safetyStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { useSharingStore } from "@/features/location-sharing/store/sharingStore";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { syncWidgets } from "@/features/widget/syncWidgets";
import { resetAnalytics } from "@/services/analytics";
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
 * leave the rest of the data behind; MMKV is cleared last. `keepModels`
 * keeps the downloaded AI model files, which hold no user data.
 */
export async function wipeAllDeviceData({ keepModels = false }: { keepModels?: boolean } = {}): Promise<void> {
  await signOutAndCleanup();

  await attempt(() => aiService.stopChat());
  await attempt(() => localModelService.release());
  if (!keepModels) await attempt(wipeModels);

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
  await attempt(clearLegacyGmailCheckpoints);
  await attempt(() => secureStorage.resetPin());
  await attempt(() => pinAttempts.reset());
  await attempt(clearByokConfig);
  clearCloudExhaustion();
  usePlanStore.getState().reset();

  storage.clearAll();
  // Rewrites the widgets (and the iOS App Group copy of trip names) from the now-empty trip store.
  await attempt(syncWidgets);
  // PostHog keeps its IDs in memory, so rotate them after its stored copy is gone.
  resetAnalytics();
}
