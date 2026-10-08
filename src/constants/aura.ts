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
export const auraCategoryColors = { food: "#FF7A6B", stays: "#22C7B8", travel: "#FFB547", shopping: "#5B8CFF", fees: "#B07CFF", other: "#9AA0B4" } as const;

/** Signal colours repeated across features: ready/live green, danger red, teal and amber. */
export const auraSignal = {
  ready: "#3DDC97",
  danger: auraStatusAccent.alert,
  teal: "#22C7B8",
  amber: auraStatusAccent.live,
} as const;

/** Type scale for cards, sheets and empty states; tuned one-offs (hero amounts, replay) keep their own sizes. */
export const auraType = {
  micro: 11,
  caption: 12.5,
  footnote: 13.5,
  body: 15,
  bodyStrong: 15.5,
  title: 17,
  section: 19,
  sheetTitle: 22,
  display: 30,
} as const;

/** Spacing scale; `cardPad` is AuraCard's padding and `screen` the horizontal screen margin. */
export const auraSpace = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  cardPad: 18,
  xl: 20,
  screen: 20,
  xxl: 24,
  section: 32,
} as const;

/** Corner radii; `group` is AuraListGroup's grouped list. */
export const auraRadius = {
  card: 24,
  group: 22,
  sheet: 30,
  tile: 16,
  iconTile: 11,
  chip: 17,
  pill: 999,
} as const;

/** Minimum touch target in points; pad smaller controls up to it with `hitSlop`. */
export const AURA_MIN_TOUCH = 44;

/** hitSlop that grows a square control of `size` points to the minimum touch target. */
export function auraHitSlop(size: number) {
  const pad = Math.max(0, Math.ceil((AURA_MIN_TOUCH - size) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}
