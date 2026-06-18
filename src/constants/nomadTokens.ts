export const NOMAD_LIGHT = {
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
} as const;

export const NOMAD_DARK = {
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
} as const;

export type NomadTheme = typeof NOMAD_LIGHT;

export const NOMAD_FONTS = {
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

export function getNomadTheme(dark: boolean): NomadTheme {
  return (dark ? NOMAD_DARK : NOMAD_LIGHT) as NomadTheme;
}
