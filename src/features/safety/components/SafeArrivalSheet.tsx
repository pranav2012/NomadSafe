import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraChip, AuraSheet, Icon, type IconName, useAura } from "@/atoms";
import { useLocalization } from "@/localization";

interface SafeArrivalSheetProps {
  visible: boolean;
  onClose: () => void;
  presets: { duration: number; label: string }[];
  selected: number;
  formatTime: (date: Date | number) => string;
  circleEmpty: boolean;
  onSelect: (seconds: number) => void;
  onStart: () => void;
  onAddPeople: () => void;
}

/** Explains the safe-arrival timer in three steps, then picks a length and starts it. */
export function SafeArrivalSheet({
  visible,
  onClose,
  presets,
  selected,
  formatTime,
  circleEmpty,
  onSelect,
  onStart,
  onAddPeople,
}: SafeArrivalSheetProps) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [visible]);
  const steps: { icon: IconName; text: string }[] = [
    { icon: "clock", text: t("safety.timerStep1") },
    { icon: "bell", text: t("safety.timerStep2") },
    { icon: "users", text: t("safety.timerStep3") },
  ];

  return (
    <AuraSheet
      visible={visible}
      onClose={onClose}
      title={t("safety.timerTitle")}
      footer={<AuraButton label={t("safety.timerStart", { time: formatTime(now + selected * 1000) })} icon="clock" onPress={onStart} />}
    >
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {steps.map((step) => (
          <View key={step.text} style={styles.step}>
            <View style={[styles.stepIcon, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}>
              <Icon name={step.icon} size={15} color={c.text} />
            </View>
            <Text style={[styles.stepText, { color: c.textSoft, fontFamily: f.regular }]}>{step.text}</Text>
          </View>
        ))}

        <Text style={[styles.label, { color: c.textMuted, fontFamily: f.medium }]}>{t("safety.timerHowLong")}</Text>
        <View style={styles.presets} accessibilityRole="radiogroup">
          {presets.map((p) => (
            <AuraChip key={p.duration} label={p.label} selected={p.duration === selected} onPress={() => onSelect(p.duration)} />
          ))}
        </View>

        {circleEmpty ? (
          <View style={[styles.warn, { backgroundColor: "#FFB54714", borderColor: "#FFB54755" }]}>
            <Text style={[styles.warnText, { color: c.text, fontFamily: f.regular }]}>{t("safety.timerNoCircle")}</Text>
            <AuraButton label={t("circle.addPerson")} icon="plus" size="md" variant="secondary" onPress={onAddPeople} />
          </View>
        ) : null}
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 8 },
  step: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  stepIcon: { width: 32, height: 32, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  stepText: { flex: 1, fontSize: 14, lineHeight: 19 },
  label: { fontSize: 13, marginTop: 18, marginBottom: 10 },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  warn: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10, marginTop: 18 },
  warnText: { fontSize: 13.5, lineHeight: 19 },
});
