import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "./storage";

type ThemeMode = "light" | "dark" | "system";

interface SettingsState {
  themeMode: ThemeMode;
  onboardingCompleted: boolean;
  defaultCurrency: string;

  setThemeMode: (mode: ThemeMode) => void;
  setOnboardingCompleted: (value: boolean) => void;
  setDefaultCurrency: (currency: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: "system",
      onboardingCompleted: false,
      defaultCurrency: "USD",

      setThemeMode: (mode) => set({ themeMode: mode }),
      setOnboardingCompleted: (value) => set({ onboardingCompleted: value }),
      setDefaultCurrency: (currency) => set({ defaultCurrency: currency }),
    }),
    {
      name: "settings-store",
      storage: createJSONStorage(() => mmkvStateStorage),
    },
  ),
);
