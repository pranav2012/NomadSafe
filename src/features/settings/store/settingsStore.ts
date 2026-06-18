import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";
import type { SupportedLocale } from "@/localization/languages";
import { normalizeCurrencyCode } from "@/utils/currency";

type ThemeMode = "light" | "dark" | "system";

interface SettingsState {
  themeMode: ThemeMode;
  onboardingCompleted: boolean;
  defaultCurrency: string;
  currencyOverride: string | null;
  localeOverride: SupportedLocale | null;

  setThemeMode: (mode: ThemeMode) => void;
  setOnboardingCompleted: (value: boolean) => void;
  setDefaultCurrency: (currency: string) => void;
  setCurrencyOverride: (currency: string | null) => void;
  setLocaleOverride: (locale: SupportedLocale | null) => void;
}

type PersistedSettingsState = Partial<SettingsState>;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: "system",
      onboardingCompleted: false,
      defaultCurrency: "USD",
      currencyOverride: null,
      localeOverride: null,

      setThemeMode: (mode) => set({ themeMode: mode }),
      setOnboardingCompleted: (value) => set({ onboardingCompleted: value }),
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
