import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useAura } from "./useAura";

/** Sentence-case section title with optional actions on the right. */
export function AuraSection({ title, action, style }: { title: string; action?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, f } = useAura();
  return (
    <View style={[styles.row, style]}>
      <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{title}</Text>
      {action ? <View style={styles.actions}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 32, marginBottom: 14 },
  title: { fontSize: 19, letterSpacing: -0.3, flexShrink: 1 },
  actions: { flexDirection: "row", gap: 8 },
});
