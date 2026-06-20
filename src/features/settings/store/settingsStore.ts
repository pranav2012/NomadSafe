import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";
import type { SupportedLocale } from "@/localization/languages";
import { normalizeCurrencyCode } from "@/utils/currency";

type ThemeMode = "light" | "dark" | "system";
export type DefaultTripMode = "solo" | "group";

interface SettingsState {
  themeMode: ThemeMode;
  onboardingCompleted: boolean;
  onboardingStep: number;
  defaultCurrency: string;
  currencyOverride: string | null;
  localeOverride: SupportedLocale | null;
  tripModeEnabled: boolean;
  defaultTripMode: DefaultTripMode;
  defaultCheckInDuration: number; // seconds
  localAiEnabled: boolean;

  setThemeMode: (mode: ThemeMode) => void;
  setOnboardingCompleted: (value: boolean) => void;
  setOnboardingStep: (step: number) => void;
  setDefaultCurrency: (currency: string) => void;
  setCurrencyOverride: (currency: string | null) => void;
  setLocaleOverride: (locale: SupportedLocale | null) => void;
  setTripModeEnabled: (value: boolean) => void;
  setDefaultTripMode: (mode: DefaultTripMode) => void;
  setDefaultCheckInDuration: (seconds: number) => void;
  setLocalAiEnabled: (value: boolean) => void;
  reset: () => void;
}

type PersistedSettingsState = Partial<SettingsState>;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: "system",
      onboardingCompleted: false,
      onboardingStep: 0,
      defaultCurrency: "USD",
      currencyOverride: null,
      localeOverride: null,
      tripModeEnabled: true,
      defaultTripMode: "solo",
      defaultCheckInDuration: 2 * 60 * 60,
      localAiEnabled: true,

      setThemeMode: (mode) => set({ themeMode: mode }),
      setOnboardingCompleted: (value) =>
        set({ onboardingCompleted: value, onboardingStep: 0 }),
      setOnboardingStep: (step) => set({ onboardingStep: step }),
      setDefaultCurrency: (currency) => {
        const normalizedCurrency = normalizeCurrencyCode(currency);
        set({ defaultCurrency: normalizedCurrency, currencyOverride: normalizedCurrency });
      },
      setCurrencyOverride: (currency) => {
        const normalizedCurrency = currency ? normalizeCurrencyCode(currency) : null;
        set({
          currencyOverride: normalizedCurrency,
          defaultCurrency: normalizedCurrency ?? "USD",
        });
      },
      setLocaleOverride: (locale) => set({ localeOverride: locale }),
      setTripModeEnabled: (value) => set({ tripModeEnabled: value }),
      setDefaultTripMode: (mode) => set({ defaultTripMode: mode }),
      setDefaultCheckInDuration: (seconds) => set({ defaultCheckInDuration: seconds }),
      setLocalAiEnabled: (value) => set({ localAiEnabled: value }),
      reset: () =>
        set({
          themeMode: "system",
          onboardingCompleted: false,
          onboardingStep: 0,
          defaultCurrency: "USD",
          currencyOverride: null,
          localeOverride: null,
          tripModeEnabled: true,
          defaultTripMode: "solo",
          defaultCheckInDuration: 2 * 60 * 60,
          localAiEnabled: true,
        }),
    }),
    {
      name: "settings-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 1,
      migrate: (persistedState) => {
        const state = persistedState as PersistedSettingsState;
        const migratedCurrencyOverride =
          state.currencyOverride
            ? normalizeCurrencyCode(state.currencyOverride)
            : state.defaultCurrency && state.defaultCurrency !== "USD"
              ? normalizeCurrencyCode(state.defaultCurrency)
              : null;

        return {
          ...state,
          defaultCurrency: migratedCurrencyOverride ?? "USD",
          currencyOverride: migratedCurrencyOverride,
        };
      },
    },
  ),
);
