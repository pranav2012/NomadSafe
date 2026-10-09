import React from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { useAuthStore } from "../store/authStore";

// Stays up a little after sign-out ends, so the move to sign-in happens underneath it.
const EXIT_DELAY_MS = 350;

/** Full-screen "Signing out…" cover over every route while sign-out runs. */
export function SignOutCover() {
  const signingOut = useAuthStore((s) => s.signingOut);
  const { c, f } = useAura();
  const { t } = useLocalization();

  if (!signingOut) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.delay(EXIT_DELAY_MS).duration(250)}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: c.bg }]}
    >
      <ActivityIndicator color={c.text} />
      <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("auth.signingOut")}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center", gap: 14 },
  label: { fontSize: 15 },
});
