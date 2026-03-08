import { useThemeContext } from "@/providers/ThemeProvider";
import { typography, spacing, radii, shadows } from "@/constants/theme";

export function useTheme() {
  const { colors, isDark } = useThemeContext();
  return { colors, isDark, typography, spacing, radii, shadows };
}
