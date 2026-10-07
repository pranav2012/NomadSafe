import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/atoms/nomad/Icon";
import { auraRadius, auraSpace, auraType } from "@/constants/aura";
import { useAura } from "./useAura";

/** Centred empty state: icon in a soft circle, title and/or body, optional action; on a card unless `plain`. */
export function AuraEmptyState({
  icon,
  title,
  body,
  tone,
  action,
  plain = false,
  style,
}: {
  icon: IconName;
  title?: string;
  body?: string;
  tone?: string;
  action?: React.ReactNode;
  plain?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, f } = useAura();
  return (
    <View style={[styles.root, !plain && [styles.card, { backgroundColor: c.surface, borderColor: c.hairline }], style]}>
      <View style={[styles.iconCircle, { backgroundColor: tone ? `${tone}1F` : c.surfaceStrong }]}>
        <Icon name={icon} size={24} color={tone ?? c.textSoft} />
      </View>
      {title ? (
        <Text accessibilityRole="header" style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
          {title}
        </Text>
      ) : null}
      {body ? <Text style={[styles.body, !title && styles.bodyOnly, { color: c.textSoft, fontFamily: f.regular }]}>{body}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", paddingVertical: 28, paddingHorizontal: auraSpace.cardPad },
  card: { borderRadius: auraRadius.card, borderWidth: StyleSheet.hairlineWidth },
  iconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  title: { fontSize: auraType.title, marginTop: 14, textAlign: "center" },
  body: { fontSize: 14, lineHeight: 20, marginTop: auraSpace.xs, textAlign: "center" },
  bodyOnly: { marginTop: 14 },
  action: { marginTop: auraSpace.lg },
});
