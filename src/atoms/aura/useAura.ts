import { auraDark, auraFonts, auraLight, auraStatusAccent } from "@/constants/aura";
import { useTheme } from "@/hooks/useTheme";

/** Aura palette and fonts for the current light/dark mode. */
export function useAura() {
  const { isDark } = useTheme();
  return { c: isDark ? auraDark : auraLight, f: auraFonts, isDark, accent: auraStatusAccent.calm };
}
