import React from "react";
import { StyleSheet, View } from "react-native";
import { Icon, useAura } from "@/atoms";

/** Opaque cover shown in the iOS app switcher instead of the app's content. */
export function PrivacyCover() {
  const { c } = useAura();
  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Icon name="lock" size={36} color={c.textMuted} strokeWidth={1.8} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
});
