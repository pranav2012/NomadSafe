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

export type ThemeColors = typeof lightColors;

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
