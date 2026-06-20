import * as FileSystem from "expo-file-system/legacy";
import { Share } from "react-native";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useSafetyStore } from "@/features/safety/store/safetyStore";
import { useSharingStore } from "@/features/location-sharing/store/sharingStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { aiModelService } from "@/features/ai/services/aiModelService";

export interface NomadSafeExport {
  exportedAt: string;
  version: string;
  user: { name: string | null; email?: string; phone?: string } | null;
  trips: ReturnType<typeof useTripsStore.getState>["trips"];
  expenses: ReturnType<typeof useExpensesStore.getState>["expenses"];
  safetyEvents: ReturnType<typeof useSafetyStore.getState>["events"];
  trustedContacts: ReturnType<typeof useSafetyStore.getState>["trustedContacts"];
  shareRecipients: ReturnType<typeof useSharingStore.getState>["recipients"];
  geofences: ReturnType<typeof useSharingStore.getState>["geofences"];
  settings: {
    themeMode: string;
    defaultCurrency: string;
    localeOverride: string | null;
    defaultTripMode: string;
    defaultCheckInDuration: number;
  };
  emergencyContacts: ReturnType<typeof emergencyContactsStorage.get>;
  aiModel: { activeId: string | null; downloadedId: string | null } | null;
}

function buildExport(): NomadSafeExport {
  const user = useAuthStore.getState().user;
  const settings = useSettingsStore.getState();
  return {
    exportedAt: new Date().toISOString(),
    version: "1.0.0",
    user: user
      ? {
          name: user.name ?? null,
          email: user.email,
          phone: user.phone,
        }
      : null,
    trips: useTripsStore.getState().trips,
    expenses: useExpensesStore.getState().expenses,
    safetyEvents: useSafetyStore.getState().events,
    trustedContacts: useSafetyStore.getState().trustedContacts,
    shareRecipients: useSharingStore.getState().recipients,
    geofences: useSharingStore.getState().geofences,
    settings: {
      themeMode: settings.themeMode,
      defaultCurrency: settings.defaultCurrency,
      localeOverride: settings.localeOverride,
      defaultTripMode: settings.defaultTripMode,
      defaultCheckInDuration: settings.defaultCheckInDuration,
    },
    emergencyContacts: emergencyContactsStorage.get(),
    aiModel: {
      activeId: aiModelService.getActiveModelId(),
      downloadedId: aiModelService.getDownloadedModelId(),
    },
  };
}

/**
 * Exports all on-device NomadSafe data as a JSON file and opens the native
 * share sheet so the user can save it to Files / Notes / messaging apps.
 *
 * Returns the file URI the JSON was written to.
 */
export async function exportEverything(): Promise<string> {
  const payload = buildExport();
  const fileName = `nomadsafe-export-${Date.now()}.json`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(payload, null, 2));

  try {
    await Share.share({
      title: "NomadSafe Export",
      url: fileUri,
    });
  } catch {
    // User dismissed the share sheet; that is not an error.
  }

  return fileUri;
}
