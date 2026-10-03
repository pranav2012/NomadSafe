import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { useSettingsStore } from "@/features/settings";
import {
  lightColors,
  darkColors,
  createNomadTheme,
  type ThemeColors,
  type NomadTheme,
} from "@/constants/theme";

interface ThemeContextValue {
  colors: ThemeColors;
  nomad: NomadTheme;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const systemScheme = useColorScheme();

  const resolved = useMemo(() => {
    const effectiveScheme = themeMode === "system" ? systemScheme : themeMode;
    const isDark = effectiveScheme === "dark";
    return {
      colors: isDark ? darkColors : lightColors,
      nomad: createNomadTheme(isDark),
      isDark,
    };
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

/** Re-themes a subtree with a different Nomad theme (e.g. a redesigned screen hosting older sections). */
export function ThemeScope({ nomad, children }: { nomad: NomadTheme; children: React.ReactNode }) {
  const parent = useThemeContext();
  const value = useMemo(() => ({ ...parent, nomad }), [nomad, parent]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
