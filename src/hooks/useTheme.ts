import { useThemeContext } from "@/providers/ThemeProvider";
import { typography, spacing, radii, shadows } from "@/constants/theme";

export function useTheme() {
  const { colors, nomad, isDark } = useThemeContext();
  return { colors, nomad, isDark, typography, spacing, radii, shadows };
}
