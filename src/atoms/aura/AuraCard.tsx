import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useAura } from "./useAura";

/** Translucent rounded surface with a hairline top highlight, as used by Home's spend card. */
export function AuraCard({ children, tone, style }: { children: React.ReactNode; tone?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useAura();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tone ? `${tone}14` : c.surface, borderColor: tone ? `${tone}66` : c.hairline },
        style,
      ]}
    >
      <View style={[styles.highlight, { backgroundColor: c.highlight }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 18, overflow: "hidden" },
  highlight: { position: "absolute", top: 0, left: 28, right: 28, height: StyleSheet.hairlineWidth },
});
