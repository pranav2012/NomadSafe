import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  lightColors,
  darkColors,
  type ThemeColors,
} from "@/constants/theme";

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const systemScheme = useColorScheme();

  const resolved = useMemo(() => {
    const effectiveScheme = themeMode === "system" ? systemScheme : themeMode;
    const isDark = effectiveScheme === "dark";
    return { colors: isDark ? darkColors : lightColors, isDark };
  }, [themeMode, systemScheme]);

  return (
    <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx)
    throw new Error("useThemeContext must be used within ThemeProvider");
  return ctx;
}
