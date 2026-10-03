import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraListGroup } from "@/components/aura/AuraList";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { useAura } from "@/components/aura/useAura";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { selectionChanged } from "@/utils/haptics";

export interface SettingsOption<T> {
  value: T;
  label: string;
  detail?: string;
}

interface SettingsOptionSheetProps<T> {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  options: readonly SettingsOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
  footnote?: string;
}

/** Single-choice picker in an AuraSheet: a list of options with a check on the current one; closes on pick. */
export function SettingsOptionSheet<T extends string | number | null>({
  visible,
  onClose,
  title,
  subtitle,
  options,
  selected,
  onSelect,
  footnote,
}: SettingsOptionSheetProps<T>) {
  const { c, f, accent } = useAura();

  return (
    <AuraSheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <AuraListGroup footer={footnote} style={styles.group}>
          {options.map((option) => {
            const active = option.value === selected;
            return (
              <PressableScale
                key={String(option.value)}
                haptic={false}
                pressedScale={0.985}
                onPress={() => {
                  selectionChanged();
                  onSelect(option.value);
                  onClose();
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={option.detail ? `${option.label}, ${option.detail}` : option.label}
                style={styles.row}
              >
                <View style={styles.text}>
                  <Text style={[styles.label, { color: c.text, fontFamily: active ? f.semibold : f.medium }]}>{option.label}</Text>
                  {option.detail ? (
                    <Text style={[styles.detail, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={2}>
                      {option.detail}
                    </Text>
                  ) : null}
                </View>
                {active ? <Icon name="check" size={18} color={accent} strokeWidth={2.2} /> : null}
              </PressableScale>
            );
          })}
        </AuraListGroup>
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 12 },
  group: { marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 54, paddingHorizontal: 16, paddingVertical: 10 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 15.5 },
  detail: { fontSize: 12.5, lineHeight: 17 },
});
