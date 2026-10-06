import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, Icon, PressableScale, useAura } from "@/atoms";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import type { MustDo } from "@/features/itinerary/utils/mustDos";

/** One suggested sight: its name, an add button and a dismiss "×". */
export function MustDoRow({ item, actionLabel, onAdd, onDismiss }: { item: MustDo; actionLabel: string; onAdd: () => void; onDismiss: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  return (
    <View style={styles.row}>
      <Icon name={item.type === "food" ? "utensils" : "star"} size={15} color={auraEventColors[item.type]} />
      <Text numberOfLines={1} style={[styles.name, { color: c.text, fontFamily: f.medium }]}>
        {item.name}
      </Text>
      <AuraButton size="md" variant="secondary" label={actionLabel} onPress={onAdd} />
      <PressableScale
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t("itinerary.mustDo.dismiss", { name: item.name })}
        style={[styles.dismiss, { backgroundColor: c.surfaceStrong }]}
      >
        <Icon name="x" size={13} color={c.textMuted} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { flex: 1, fontSize: 14.5 },
  dismiss: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
