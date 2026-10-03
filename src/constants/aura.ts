import { createNomadTheme, type NomadColors, type NomadTheme } from "@/constants/theme";
import { InstrumentSans_400Regular } from "@expo-google-fonts/instrument-sans/400Regular";
import { InstrumentSans_500Medium } from "@expo-google-fonts/instrument-sans/500Medium";
import { InstrumentSans_600SemiBold } from "@expo-google-fonts/instrument-sans/600SemiBold";
import { InstrumentSans_700Bold } from "@expo-google-fonts/instrument-sans/700Bold";

export const AURA_FONT_FILES = {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
};

export const auraFonts = {
  regular: "InstrumentSans_400Regular",
  medium: "InstrumentSans_500Medium",
  semibold: "InstrumentSans_600SemiBold",
  bold: "InstrumentSans_700Bold",
} as const;

export type AuraStatus = "calm" | "live" | "alert";

export interface AuraPalette {
  bg: string;
  surface: string;
  surfaceStrong: string;
  card: string;
  hairline: string;
  highlight: string;
  text: string;
  textSoft: string;
  textMuted: string;
  inverse: string;
  onInverse: string;
}

export const auraDark: AuraPalette = {
  bg: "#0B0D12",
  surface: "rgba(255,255,255,0.045)",
  surfaceStrong: "rgba(255,255,255,0.08)",
  card: "#161922",
  hairline: "rgba(255,255,255,0.08)",
  highlight: "rgba(255,255,255,0.16)",
  text: "#EDEFF5",
  textSoft: "#B6BACA",
  textMuted: "#7D8296",
  inverse: "#EDEFF5",
  onInverse: "#0B0D12",
};

export const auraLight: AuraPalette = {
  bg: "#F3F4F7",
  surface: "rgba(255,255,255,0.72)",
  surfaceStrong: "#FFFFFF",
  card: "#FFFFFF",
  hairline: "rgba(14,16,24,0.08)",
  highlight: "rgba(255,255,255,0.9)",
  text: "#0E1018",
  textSoft: "#3E4252",
  textMuted: "#6B7083",
  inverse: "#0E1018",
  onInverse: "#FFFFFF",
};

/** Three aura colours per safety state; the only saturated colour in the UI. */
export const auraStatusColors: Record<AuraStatus, [string, string, string]> = {
  calm: ["#5B6CFF", "#22C7B8", "#9B7BFF"],
  live: ["#FF9F2E", "#FF5F6D", "#FFC56B"],
  alert: ["#FF3B4E", "#FF7A45", "#C2185B"],
};

/** Solid accent for each state, for dots, chart lines and focus rings. */
export const auraStatusAccent: Record<AuraStatus, string> = {
  calm: "#8B97FF",
  live: "#FFB547",
  alert: "#FF4D5E",
};

/**
 * The legacy Nomad theme re-pointed at Aura colours and Instrument Sans, so older sections
 * (weather, itinerary, nearby places) blend into the new Home until they are redesigned.
 */
export function auraNomadTheme(isDark: boolean): NomadTheme {
  const base = createNomadTheme(isDark);
  const c = isDark ? auraDark : auraLight;
  const soft = (hex: string) => `${hex}${isDark ? "26" : "1F"}`;
  const colors = {
    ...base.colors,
    paper: c.bg,
    paperDeep: isDark ? "#07090D" : "#E8EAEF",
    paperSoft: c.card,
    inkDeep: c.text,
    ink: c.text,
    inkSoft: c.textSoft,
    inkMuted: c.textMuted,
    hairline: c.hairline,
    teal: "#22C7B8",
    tealSoft: soft("#22C7B8"),
    stamp: "#8B97FF",
    stampSoft: soft("#8B97FF"),
    mustard: "#FFB547",
    mustardSoft: soft("#FFB547"),
    sky: "#5B8CFF",
    skySoft: soft("#5B8CFF"),
  } as unknown as NomadColors;
  return {
    ...base,
    colors,
    fonts: {
      ...base.fonts,
      display: auraFonts.semibold,
      displayItalic: auraFonts.medium,
      displayBold: auraFonts.bold,
      ui: auraFonts.regular,
      uiMedium: auraFonts.medium,
      uiSemi: auraFonts.semibold,
      uiBold: auraFonts.bold,
    } as unknown as NomadTheme["fonts"],
  };
}
