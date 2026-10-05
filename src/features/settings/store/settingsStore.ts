import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import type { SupportedLocale } from "@/localization/languages";
import { normalizeCurrencyCode } from "@/utils/currency";
import type { TimeFormat, UnitSystem } from "@/utils/units";

type ThemeMode = "light" | "dark" | "system";
export type DefaultTripMode = "solo" | "group";

interface SettingsState {
  themeMode: ThemeMode;
  onboardingCompleted: boolean;
  onboardingStep: number;
  /** The user's pick for new trips and amounts; null follows the phone. Read the result with `useDefaultCurrency()`. */
  currencyOverride: string | null;
  localeOverride: SupportedLocale | null;
  /** null follows the phone's region (see `resolveUnitPrefs`). */
  unitSystem: UnitSystem | null;
  /** null follows the phone's 12/24-hour setting. */
  timeFormat: TimeFormat | null;
  tripModeEnabled: boolean;
  defaultTripMode: DefaultTripMode;
  defaultCheckInDuration: number; // seconds
  localAiEnabled: boolean;
  /** Use the user's own key or NomadSafe Cloud when online; off keeps all AI on the phone. */
  onlineAiEnabled: boolean;
  onlineAiNoticeSeen: boolean;
  analyticsEnabled: boolean;
  ambientSoundEnabled: boolean;
  /** Back up trips, expenses and itinerary to the signed-in account. */
  cloudBackupEnabled: boolean;
  /** ISO 3166-1 alpha-2; null follows the phone's region. Read it with `useHomeCountry()`. */
  homeCountry: string | null;

  setThemeMode: (mode: ThemeMode) => void;
  setOnboardingCompleted: (value: boolean) => void;
  setOnboardingStep: (step: number) => void;
  setCurrencyOverride: (currency: string | null) => void;
  setLocaleOverride: (locale: SupportedLocale | null) => void;
  setUnitSystem: (system: UnitSystem | null) => void;
  setTimeFormat: (format: TimeFormat | null) => void;
  setTripModeEnabled: (value: boolean) => void;
  setDefaultTripMode: (mode: DefaultTripMode) => void;
  setDefaultCheckInDuration: (seconds: number) => void;
  setLocalAiEnabled: (value: boolean) => void;
  setOnlineAiEnabled: (value: boolean) => void;
  setOnlineAiNoticeSeen: (value: boolean) => void;
  setAnalyticsEnabled: (value: boolean) => void;
  setAmbientSoundEnabled: (value: boolean) => void;
  setCloudBackupEnabled: (value: boolean) => void;
  setHomeCountry: (code: string | null) => void;
  reset: () => void;
}

// `defaultCurrency` (removed in v2) mirrored the override with a "USD" fallback.
type PersistedSettingsState = Partial<SettingsState> & { defaultCurrency?: string };

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: "dark",
      onboardingCompleted: false,
      onboardingStep: 0,
      currencyOverride: null,
      localeOverride: null,
      unitSystem: null,
      timeFormat: null,
      tripModeEnabled: true,
      defaultTripMode: "solo",
      defaultCheckInDuration: 2 * 60 * 60,
      localAiEnabled: true,
      onlineAiEnabled: true,
      onlineAiNoticeSeen: false,
      analyticsEnabled: true,
      ambientSoundEnabled: true,
      cloudBackupEnabled: true,
      homeCountry: null,

      setThemeMode: (mode) => set({ themeMode: mode }),
      setOnboardingCompleted: (value) =>
        set({ onboardingCompleted: value, onboardingStep: 0 }),
      setOnboardingStep: (step) => set({ onboardingStep: step }),
      setCurrencyOverride: (currency) => set({ currencyOverride: currency ? normalizeCurrencyCode(currency) : null }),
      setLocaleOverride: (locale) => set({ localeOverride: locale }),
      setUnitSystem: (system) => set({ unitSystem: system }),
      setTimeFormat: (format) => set({ timeFormat: format }),
      setTripModeEnabled: (value) => set({ tripModeEnabled: value }),
      setDefaultTripMode: (mode) => set({ defaultTripMode: mode }),
      setDefaultCheckInDuration: (seconds) => set({ defaultCheckInDuration: seconds }),
      setLocalAiEnabled: (value) => set({ localAiEnabled: value }),
      setOnlineAiEnabled: (value) => set({ onlineAiEnabled: value }),
      setOnlineAiNoticeSeen: (value) => set({ onlineAiNoticeSeen: value }),
      setAnalyticsEnabled: (value) => set({ analyticsEnabled: value }),
      setAmbientSoundEnabled: (value) => set({ ambientSoundEnabled: value }),
      setCloudBackupEnabled: (value) => set({ cloudBackupEnabled: value }),
      setHomeCountry: (code) => set({ homeCountry: code }),
      reset: () =>
        set({
          themeMode: "dark",
          onboardingCompleted: false,
          onboardingStep: 0,
          currencyOverride: null,
          localeOverride: null,
          unitSystem: null,
          timeFormat: null,
          tripModeEnabled: true,
          defaultTripMode: "solo",
          defaultCheckInDuration: 2 * 60 * 60,
          localAiEnabled: true,
          onlineAiEnabled: true,
          onlineAiNoticeSeen: false,
          analyticsEnabled: true,
          ambientSoundEnabled: true,
          cloudBackupEnabled: true,
          homeCountry: null,
        }),
    }),
    {
      name: "settings-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 2,
      // v0 kept a non-USD pick only in `defaultCurrency`; v1 mirrored the override there.
      migrate: (persistedState) => {
        const { defaultCurrency, ...state } = persistedState as PersistedSettingsState;
        const currencyOverride = state.currencyOverride
          ? normalizeCurrencyCode(state.currencyOverride)
          : defaultCurrency && defaultCurrency !== "USD"
            ? normalizeCurrencyCode(defaultCurrency)
            : null;
        return { ...state, currencyOverride };
      },
    },
  ),
);
