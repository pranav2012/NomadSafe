import React from "react";
import { Platform, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAura } from "./useAura";

const FADE_PX = 20;

/**
 * Fades scrolled content out under the status bar so it never overlaps the clock. Place it right after
 * the screen's scroll view. `sheet` screens skip it on iOS, where page sheets sit below the status bar.
 */
export function AuraTopFade({ sheet = false }: { sheet?: boolean }) {
  const { c } = useAura();
  const { top } = useSafeAreaInsets();
  if (sheet && Platform.OS === "ios") return null;
  const height = top + FADE_PX;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[c.bg, `${c.bg}E6`, `${c.bg}00`]}
      locations={[0, top / height, 1]}
      style={[styles.fade, { height }]}
    />
  );
}

const styles = StyleSheet.create({
  fade: { position: "absolute", top: 0, left: 0, right: 0 },
});
