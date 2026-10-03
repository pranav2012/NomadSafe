import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useAura } from "@/components/aura/useAura";

/** Big sentence-case headline and lede that opens every onboarding step. */
export function StepHeader({ title, lede, style }: { title: string; lede?: string; style?: StyleProp<ViewStyle> }) {
  const { c, f } = useAura();
  return (
    <View style={[styles.root, style]}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
        {title}
      </Text>
      {lede ? <Text style={[styles.lede, { color: c.textSoft, fontFamily: f.regular }]}>{lede}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  title: { fontSize: 34, letterSpacing: -1.2, lineHeight: 38 },
  lede: { fontSize: 15, lineHeight: 22 },
});
