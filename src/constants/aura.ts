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


/** Itinerary event type colours in the Aura palette. */
export const auraEventColors = { transit: "#FFB547", stay: "#22C7B8", activity: "#8B97FF", food: "#FF7A8A", note: "#9AA3B5" } as const;

/** Expense category colours in the Aura palette. */
export const auraCategoryColors = { food: "#FF7A6B", stays: "#22C7B8", travel: "#FFB547", shopping: "#5B8CFF", other: "#9AA0B4" } as const;
