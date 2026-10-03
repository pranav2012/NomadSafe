import { useMemo } from "react";
import type { NomadTheme } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";

/** Builds a stylesheet from the current theme's fonts, so a ThemeScope can restyle typography too. */
export function useThemedStyles<T>(factory: (fonts: NomadTheme["fonts"]) => T): T {
  const { nomad } = useTheme();
  return useMemo(() => factory(nomad.fonts), [factory, nomad.fonts]);
}
