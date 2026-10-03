import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { selectionChanged } from "@/utils/haptics";
import { useAura } from "./useAura";

interface AuraChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Colour dot shown before the label (e.g. an event type). */
  dot?: string;
  onRemove?: () => void;
}

export function AuraChip({ label, selected = false, onPress, icon, dot, onRemove }: AuraChipProps) {
  const { c, f } = useAura();
  const fg = selected ? c.onInverse : c.text;
  return (
    <PressableScale
      haptic={false}
      onPress={
        onPress
          ? () => {
              selectionChanged();
              onPress();
            }
          : undefined
      }
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? c.inverse : c.surfaceStrong, borderColor: selected ? c.inverse : c.hairline }]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <Text numberOfLines={1} style={[styles.label, { color: fg, fontFamily: f.medium }]}>
        {label}
      </Text>
      {onRemove ? (
        <PressableScale onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
          <Icon name="x" size={13} color={c.textMuted} />
        </PressableScale>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: 13, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 13.5, maxWidth: 220 },
});
