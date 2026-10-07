import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { auraRadius, auraSpace } from "@/constants/aura";
import { useAura } from "./useAura";

/** Translucent rounded surface with a faint hairline border, as used by Home's spend card. */
export function AuraCard({ children, tone, style }: { children: React.ReactNode; tone?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useAura();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tone ? `${tone}14` : c.surface, borderColor: tone ? `${tone}33` : c.hairline },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: auraRadius.card, borderWidth: StyleSheet.hairlineWidth, padding: auraSpace.cardPad, overflow: "hidden" },
});
