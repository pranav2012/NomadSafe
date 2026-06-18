export const palette = {
  blue: {
    50: "#E6F4FE",
    100: "#BAE0FD",
    500: "#0A84FF",
    600: "#0070E0",
    700: "#005BB5",
    900: "#002F5F",
  },
  green: { 50: "#E8F9EF", 500: "#34C759", 700: "#248A3D" },
  red: { 50: "#FEE9E7", 500: "#FF3B30", 700: "#C62828" },
  orange: { 50: "#FFF3E0", 500: "#FF9500", 700: "#C77800" },
  yellow: { 50: "#FFFDE7", 500: "#FFCC00" },
  gray: {
    50: "#F9FAFB",
    100: "#F3F4F6",
    200: "#E5E7EB",
    300: "#D1D5DB",
    400: "#9CA3AF",
    500: "#6B7280",
    600: "#4B5563",
    700: "#374151",
    800: "#1F2937",
    900: "#111827",
  },
  white: "#FFFFFF",
  black: "#000000",
} as const;

export const lightColors = {
  background: palette.white,
  surface: palette.gray[50],
  surfaceElevated: palette.white,
  text: palette.gray[900],
  textSecondary: palette.gray[500],
  textTertiary: palette.gray[400],
  border: palette.gray[200],
  borderFocused: palette.blue[500],
  primary: palette.blue[500],
  primaryText: palette.white,
  success: palette.green[500],
  error: palette.red[500],
  warning: palette.orange[500],
  danger: palette.red[500],
  overlay: "rgba(0, 0, 0, 0.5)",
  tabBar: palette.white,
  tabBarBorder: palette.gray[200],
} as const;

export const darkColors = {
  background: palette.gray[900],
  surface: palette.gray[800],
  surfaceElevated: palette.gray[700],
  text: palette.gray[50],
  textSecondary: palette.gray[400],
  textTertiary: palette.gray[500],
  border: palette.gray[700],
  borderFocused: palette.blue[500],
  primary: palette.blue[500],
  primaryText: palette.white,
  success: palette.green[500],
  error: palette.red[500],
  warning: palette.orange[500],
  danger: palette.red[500],
  overlay: "rgba(0, 0, 0, 0.7)",
  tabBar: palette.gray[800],
  tabBarBorder: palette.gray[700],
} as const;

export type ThemeColors = typeof lightColors | typeof darkColors;

export const typography = {
  sizes: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    "2xl": 24,
    "3xl": 30,
    "4xl": 36,
  },
  weights: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
  lineHeights: { tight: 1.2, normal: 1.5, relaxed: 1.75 },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

export const shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
} as const;

export const nomadLightColors = {
  paper: "#F6EEE0",
  paperDeep: "#EDE4D3",
  paperSoft: "#FBF6EC",
  inkDeep: "#1A1612",
  ink: "#2B2620",
  inkSoft: "#5C544A",
  inkMuted: "#8A8175",
  hairline: "rgba(26,22,18,0.09)",

  teal: "#2B6C5F",
  tealSoft: "#E0ECE8",
  stamp: "#C6432A",
  stampSoft: "#F5DDD6",
  mustard: "#D9A441",
  mustardSoft: "#F6E8C8",
  sky: "#6B8DB3",
  skySoft: "#E2EAF3",
  cream: "#F0D89C",

  inverse: "#FFFFFF",
  shadow: "#1A1612",
  scrim: "rgba(26,22,18,0.88)",
  whiteOverlay: "rgba(255,255,255,0.08)",
  whiteOverlayStrong: "rgba(255,255,255,0.22)",
  whiteBorder: "rgba(255,255,255,0.12)",
  whiteText: "rgba(255,255,255,0.9)",
  whiteTextMuted: "rgba(255,255,255,0.65)",
  black: "#000000",
} as const;

export const nomadDarkColors = {
  paper: "#171C20",
  paperDeep: "#0F1519",
  paperSoft: "#1F2529",
  inkDeep: "#F0E6D6",
  ink: "#E4D9C7",
  inkSoft: "#9A9287",
  inkMuted: "#666056",
  hairline: "rgba(240,230,214,0.1)",

  teal: "#4FA693",
  tealSoft: "rgba(79,166,147,0.15)",
  stamp: "#E06044",
  stampSoft: "rgba(224,96,68,0.16)",
  mustard: "#E5B860",
  mustardSoft: "rgba(229,184,96,0.16)",
  sky: "#8FAAD0",
  skySoft: "rgba(143,170,208,0.16)",
  cream: "#C9A764",

  inverse: "#FFFFFF",
  shadow: "#1A1612",
  scrim: "rgba(26,22,18,0.88)",
  whiteOverlay: "rgba(255,255,255,0.08)",
  whiteOverlayStrong: "rgba(255,255,255,0.22)",
  whiteBorder: "rgba(255,255,255,0.12)",
  whiteText: "rgba(255,255,255,0.9)",
  whiteTextMuted: "rgba(255,255,255,0.65)",
  black: "#000000",
} as const;

export type NomadColors = typeof nomadLightColors;

export const nomadFonts = {
  display: "Fraunces_500Medium",
  displayItalic: "Fraunces_500Medium_Italic",
  displayBold: "Fraunces_600SemiBold",
  ui: "Geist_400Regular",
  uiMedium: "Geist_500Medium",
  uiSemi: "Geist_600SemiBold",
  uiBold: "Geist_700Bold",
  mono: "GeistMono_400Regular",
  monoMedium: "GeistMono_500Medium",
} as const;

export const nomadTypography = {
  eyebrow: { size: 10.5, weight: "700" as const, letterSpacing: 1.8 },
  headline: { size: 34, weight: "500" as const, lineHeight: 34 * 1.04 },
  body: { size: 14, lineHeight: 14 * 1.5 },
  caption: { size: 11.5 },
  monoLabel: { size: 11, letterSpacing: 0.8 },
  button: { size: 15, letterSpacing: 0 },
} as const;

export const nomadSpacing = {
  xxs: 3,
  xs: 6,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  "2xl": 24,
  "3xl": 32,
} as const;

export const nomadRadii = {
  sm: 7,
  md: 10,
  lg: 14,
  xl: 18,
  "2xl": 26,
  full: 999,
} as const;

export const nomadShadows = {
  card: {
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  mark: {
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
} as const;

export const nomadComponents = {
  button: {
    borderRadius: nomadRadii.lg,
    paddingVertical: 15,
    paddingHorizontal: nomadSpacing.xl,
  },
  card: {
    borderRadius: nomadRadii.xl,
    padding: nomadSpacing.xl,
  },
  iconMark: {
    borderRadius: nomadRadii.xl,
  },
} as const;

export function getNomadColors(dark: boolean): NomadColors {
  return (dark ? nomadDarkColors : nomadLightColors) as NomadColors;
}

export function createNomadTheme(dark: boolean) {
  return {
    colors: getNomadColors(dark),
    fonts: nomadFonts,
    typography: nomadTypography,
    spacing: nomadSpacing,
    radii: nomadRadii,
    shadows: nomadShadows,
    components: nomadComponents,
  };
}

export type NomadTheme = ReturnType<typeof createNomadTheme>;
