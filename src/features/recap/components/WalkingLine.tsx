import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import type { WalkingTotals } from "@/modules/health";

export function WalkingLine({ totals, size = 14 }: { totals: WalkingTotals; size?: number }) {
  const { c, f } = useAura();
  const { t, formatDistance, formatCompactNumber } = useLocalization();
  const steps = Math.round(totals.steps);
  const distance = formatDistance(totals.km);
  return (
    <View style={styles.row}>
      <Icon name="footprints" size={size + 2} color={c.textSoft} />
      <Text numberOfLines={2} style={[styles.text, { color: c.textSoft, fontFamily: f.medium, fontSize: size }]}>
        {t(totals.estimated ? "recap.walkedAbout" : "recap.walked", { distance, count: steps, steps: formatCompactNumber(steps) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1 },
});
