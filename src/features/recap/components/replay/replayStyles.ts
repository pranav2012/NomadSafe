import { StyleSheet } from "react-native";
import { Easing, FadeInUp } from "react-native-reanimated";
import { auraDark, auraFonts as f } from "@/constants/aura";

export const c = auraDark;
export const ACCENT = "#8B97FF";

/** Text and blocks shared by the replay's chapters. */
export const rs = StyleSheet.create({
  flex: { flex: 1 },
  block: { position: "absolute", left: 24, right: 24, gap: 10 },
  kicker: { fontFamily: f.semibold, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", color: c.textSoft },
  sub: { fontFamily: f.regular, fontSize: 16, lineHeight: 23, color: c.textSoft },
  muted: { color: c.textMuted },
  small: { fontSize: 14 },
  headline: { fontFamily: f.semibold, fontSize: 46, lineHeight: 50, letterSpacing: -1.4, color: c.text },
  big: { fontFamily: f.semibold, fontSize: 64, lineHeight: 70, letterSpacing: -2.6, color: c.text },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: c.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.hairline,
  },
  chipText: { fontFamily: f.medium, fontSize: 14, color: c.text, flexShrink: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  shadow: { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 12, textShadowOffset: { width: 0, height: 1 } },
});

/** The replay's one entrance: a calm fade with a small rise, no overshoot. Reduce motion turns it off. */
export const rise = (delay = 0, duration = 340) =>
  FadeInUp.delay(delay)
    .duration(duration)
    .easing(Easing.out(Easing.cubic))
    .withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] });
