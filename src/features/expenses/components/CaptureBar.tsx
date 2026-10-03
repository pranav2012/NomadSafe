import React, { type RefObject } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAura } from "@/components/aura/useAura";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { GlassSurface } from "@/components/tabbar/GlassSurface";
import { useLocalization } from "@/localization";

export const CAPTURE_BAR_HEIGHT = 54;

/** Floating glass "Add a spend" bar with a voice button, sitting just above the tab bar. */
export function CaptureBar({
  bottom,
  onAdd,
  onVoice,
  blurTarget,
}: {
  bottom: number;
  onAdd: () => void;
  onVoice: () => void;
  blurTarget?: RefObject<View | null>;
}) {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={[styles.bar, { borderColor: c.hairline }]}>
        <GlassSurface isDark={isDark} radius={CAPTURE_BAR_HEIGHT / 2} blurTarget={blurTarget} />
        <PressableScale onPress={onAdd} pressedScale={0.98} accessibilityRole="button" style={styles.add}>
          <View style={[styles.plus, { backgroundColor: c.inverse }]}>
            <Icon name="plus" size={16} color={c.onInverse} strokeWidth={2.4} />
          </View>
          <Text style={[styles.label, { color: c.text, fontFamily: f.medium }]}>{t("expenses.addTitle")}</Text>
        </PressableScale>
        <PressableScale
          onPress={onVoice}
          accessibilityRole="button"
          accessibilityLabel={t("voiceExpense.speakToAdd")}
          style={[styles.mic, { backgroundColor: c.surfaceStrong }]}
        >
          <Icon name="mic" size={19} color={c.text} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16 },
  bar: {
    height: CAPTURE_BAR_HEIGHT,
    borderRadius: CAPTURE_BAR_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  add: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, height: "100%", paddingLeft: 4 },
  plus: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15.5 },
  mic: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
