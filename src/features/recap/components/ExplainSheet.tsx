import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraSheet, Icon, useAura, type IconName } from "@/atoms";

/** Says what NomadSafe will do and why before a system prompt or picker opens. */
export function ExplainSheet({
  visible,
  onClose,
  icon,
  title,
  body,
  action,
  onAction,
  dismiss,
  danger,
}: {
  visible: boolean;
  onClose: () => void;
  icon: IconName;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
  dismiss?: string;
  danger?: boolean;
}) {
  const { c, f } = useAura();
  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      footer={
        <View style={styles.actions}>
          <AuraButton label={action} variant={danger ? "danger" : "primary"} onPress={onAction} />
          {dismiss ? <AuraButton label={dismiss} variant="ghost" size="md" onPress={onClose} /> : null}
        </View>
      }
    >
      <View style={styles.body}>
        <View style={[styles.icon, { backgroundColor: c.surfaceStrong }]}>
          <Icon name={icon} size={24} color={c.text} />
        </View>
        <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{title}</Text>
        <Text style={[styles.text, { color: c.textSoft, fontFamily: f.regular }]}>{body}</Text>
      </View>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 8, gap: 12 },
  icon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, letterSpacing: -0.6 },
  text: { fontSize: 16, lineHeight: 23 },
  actions: { gap: 6 },
});
