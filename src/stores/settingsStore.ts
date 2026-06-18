import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "./storage";
import type { SupportedLocale } from "@/localization/languages";

type ThemeMode = "light" | "dark" | "system";

interface SettingsState {
  themeMode: ThemeMode;
  onboardingCompleted: boolean;
  defaultCurrency: string;
  localeOverride: SupportedLocale | null;

  setThemeMode: (mode: ThemeMode) => void;
  setOnboardingCompleted: (value: boolean) => void;
  setDefaultCurrency: (currency: string) => void;
  setLocaleOverride: (locale: SupportedLocale | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: "system",
      onboardingCompleted: false,
      defaultCurrency: "USD",
      localeOverride: null,

      setThemeMode: (mode) => set({ themeMode: mode }),
      setOnboardingCompleted: (value) => set({ onboardingCompleted: value }),
      setDefaultCurrency: (currency) => set({ defaultCurrency: currency }),
      setLocaleOverride: (locale) => set({ localeOverride: locale }),
    }),
    {
      name: "settings-store",
      storage: createJSONStorage(() => mmkvStateStorage),
    },
  ),
);
