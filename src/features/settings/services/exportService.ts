import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { usePassportStore } from "@/features/passport/store/passportStore";
import { useSafetyStore } from "@/features/safety/store/safetyStore";
import { useSharingStore } from "@/features/location-sharing/store/sharingStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { aiRuntime } from "@/modules/ai";
import { getDefaultCurrency } from "@/localization";

export interface NomadSafeExport {
  exportedAt: string;
  version: string;
  user: { name: string | null; email?: string; phone?: string } | null;
  trips: ReturnType<typeof useTripsStore.getState>["trips"];
  groups: ReturnType<typeof useTripsStore.getState>["groups"];
  expenses: ReturnType<typeof useExpensesStore.getState>["expenses"];
  itineraryEvents: ReturnType<typeof useEventsStore.getState>["events"];
  pastTravel: ReturnType<typeof usePassportStore.getState>["entries"];
  safetyEvents: ReturnType<typeof useSafetyStore.getState>["events"];
  trustedContacts: ReturnType<typeof useSafetyStore.getState>["trustedContacts"];
  shareRecipients: ReturnType<typeof useSharingStore.getState>["recipients"];
  geofences: ReturnType<typeof useSharingStore.getState>["geofences"];
  settings: {
    themeMode: string;
    defaultCurrency: string;
    currencyOverride: string | null;
    localeOverride: string | null;
    homeCountry: string | null;
    defaultCheckInDuration: number;
  };
  emergencyContacts: ReturnType<typeof emergencyContactsStorage.get>;
  aiModel: { activeId: string | null } | null;
}

function buildExport(): NomadSafeExport {
  const user = useAuthStore.getState().user;
  const settings = useSettingsStore.getState();
  return {
    exportedAt: new Date().toISOString(),
    version: "2",
    user: user
      ? {
          name: user.name ?? null,
          email: user.email,
          phone: user.phone,
        }
      : null,
    trips: useTripsStore.getState().trips,
    groups: useTripsStore.getState().groups,
    expenses: useExpensesStore.getState().expenses,
    itineraryEvents: useEventsStore.getState().events,
    pastTravel: usePassportStore.getState().entries,
    safetyEvents: useSafetyStore.getState().events,
    trustedContacts: useSafetyStore.getState().trustedContacts,
    shareRecipients: useSharingStore.getState().recipients,
    geofences: useSharingStore.getState().geofences,
    settings: {
      themeMode: settings.themeMode,
      defaultCurrency: getDefaultCurrency(),
      currencyOverride: settings.currencyOverride,
      homeCountry: settings.homeCountry,
      localeOverride: settings.localeOverride,
      defaultCheckInDuration: settings.defaultCheckInDuration,
    },
    emergencyContacts: emergencyContactsStorage.get(),
    aiModel: {
      activeId: aiRuntime.provisionedModelId(),
    },
  };
}

/**
 * Writes all on-device data to a JSON file and opens the system share sheet
 * so the user can save it. The plaintext file is deleted afterwards.
 * Returns false if sharing isn't available on this device.
 */
export async function exportEverything(): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;

  const payload = buildExport();
  const fileUri = `${FileSystem.cacheDirectory}nomadsafe-export-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2));

  try {
    await Sharing.shareAsync(fileUri, {
      mimeType: "application/json",
      dialogTitle: "NomadSafe export",
      UTI: "public.json",
    });
  } finally {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
  }
  return true;
}
