import React, { createContext, useContext, useEffect, useMemo } from "react";
import { Appearance, useColorScheme } from "react-native";
import { useSettingsStore } from "@/features/settings";

interface ThemeContextValue {
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Resolves the Light / Dark / System setting to a single dark-mode flag for the Aura palettes. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const systemScheme = useColorScheme();

  // Keeps native UI (keyboard, system pickers, dialogs) on the app's theme rather than the phone's.
  useEffect(() => {
    Appearance.setColorScheme(themeMode === "system" ? "unspecified" : themeMode);
  }, [themeMode]);

  const value = useMemo(
    () => ({ isDark: (themeMode === "system" ? systemScheme : themeMode) === "dark" }),
    [themeMode, systemScheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used within ThemeProvider");
  return ctx;
}
