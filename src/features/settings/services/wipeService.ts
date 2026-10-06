import { secureStorage } from "@/features/auth/services/secureStorage";
import { pinAttempts } from "@/features/auth/services/pinAttempts";
import { useAuthStore } from "@/features/auth/store/authStore";
import { aiRuntime, aiService, clearAiUsageLog, clearByokConfig, clearCloudExhaustion, resetAiPreference } from "@/modules/ai";
import { usePlanStore } from "@/modules/billing";
import { useChatStore } from "@/features/ai/store/chatStore";
import { useKeepGroupStore } from "@/features/expenses/store/keepGroupStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { clearGlobeImagery } from "@/features/home/services/globeImagery";
import { clearLegacyGmailCheckpoints } from "@/features/expenses/services/legacyGmailCheckpoints";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useMustDoStore } from "@/features/itinerary/store/mustDoStore";
import { useTravelInfoStore } from "@/features/trips/store/travelInfoStore";
import { useRecapStore } from "@/features/recap/store/recapStore";
import { usePassportStore } from "@/features/passport/store/passportStore";
import { syncRecapNotifications } from "@/features/recap/services/recapNotifications";
import { deleteAllTripPhotos } from "@/features/recap/services/tripPhotos";
import { deleteAllTickets } from "@/features/itinerary/services/tickets";
import { resetBackgroundDisclosure } from "@/features/location-sharing/components/BackgroundLocationDisclosure";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { useSafetyStore } from "@/features/safety/store/safetyStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { useSharingStore } from "@/features/location-sharing/store/sharingStore";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { syncWidgets } from "@/features/widget/syncWidgets";
import { resetAnalytics } from "@/modules/analytics";
import { signOutAndCleanup } from "@/features/auth/services/session";
import { storage } from "@/modules/storage";

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
  await attempt(() => aiRuntime.release());
  if (!keepModels) await attempt(aiRuntime.wipeModels);

  useAuthStore.getState().setPinSet(false);
  useAuthStore.getState().setBiometricEnabled(false);
  useSettingsStore.getState().reset();
  useTripsStore.getState().reset();
  useExpensesStore.getState().reset();
  useKeepGroupStore.getState().reset();
  useEventsStore.getState().reset();
  useMustDoStore.getState().reset();
  useTravelInfoStore.getState().reset();
  useSafetyStore.getState().reset();
  useSharingStore.getState().reset();
  useChatStore.getState().reset();
  useRecapStore.getState().reset();
  usePassportStore.getState().reset();

  emergencyContactsStorage.clear();
  resetBackgroundDisclosure();
  await attempt(clearLegacyGmailCheckpoints);
  await attempt(clearGlobeImagery);
  await attempt(() => secureStorage.resetPin());
  await attempt(() => pinAttempts.reset());
  await attempt(clearByokConfig);
  clearCloudExhaustion();
  resetAiPreference();
  clearAiUsageLog();
  usePlanStore.getState().reset();
  await attempt(() => syncRecapNotifications([], {}));
  await attempt(deleteAllTripPhotos);
  await attempt(deleteAllTickets);

  storage.clearAll();
  // Rewrites the widgets (and the iOS App Group copy of trip names) from the now-empty trip store.
  await attempt(syncWidgets);
  // PostHog keeps its IDs in memory, so rotate them after its stored copy is gone.
  resetAnalytics();
}
