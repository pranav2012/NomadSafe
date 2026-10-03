import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraCard } from "@/components/aura/AuraCard";
import { AuraChip } from "@/components/aura/AuraChip";
import { useAura } from "@/components/aura/useAura";
import { auraStatusAccent } from "@/constants/aura";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { useLocalization } from "@/localization";

const ALERT = auraStatusAccent.alert;

interface CheckInCardProps {
  state: "idle" | "active" | "missed";
  /** Planned duration in seconds, shown while idle. */
  seconds: number;
  /** When the running check-in is due (ms); drives the live countdown while active or missed. */
  endsAt: number | null;
  presets: { duration: number; label: string }[];
  plannedDuration: number;
  plannedLabel: string;
  accent: string;
  missedBody: string;
  missedStatus: string | null;
  missedBusy: boolean;
  onSelectDuration: (seconds: number) => void;
  onStart: () => void;
  onCheckIn: () => void;
  onExtend: () => void;
  onSendMissedAlert: () => void;
}

export function formatCountdown(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useSecondTicker(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [running]);
  return now;
}

/** Safe-arrival timer: pick a duration, count down, and escalate when it's missed. */
export function CheckInCard({
  state,
  seconds,
  endsAt,
  presets,
  plannedDuration,
  plannedLabel,
  accent,
  missedBody,
  missedStatus,
  missedBusy,
  onSelectDuration,
  onStart,
  onCheckIn,
  onExtend,
  onSendMissedAlert,
}: CheckInCardProps) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const missed = state === "missed";
  const visible = useAnimationsActive();
  const now = useSecondTicker(visible && state !== "idle" && endsAt !== null);
  const shown =
    state === "idle" || endsAt === null
      ? seconds
      : missed
        ? Math.max(0, Math.floor((now - endsAt) / 1000))
        : Math.max(0, Math.ceil((endsAt - now) / 1000));

  return (
    <AuraCard tone={missed ? ALERT : state === "active" ? accent : undefined}>
      <Text style={[styles.label, { color: missed ? ALERT : c.textMuted, fontFamily: f.medium }]}>
        {missed ? t("safety.overdueBy") : state === "active" ? t("safety.checkInWithin") : t("safety.startCheckIn")}
      </Text>
      <Text
        accessibilityRole={missed ? "alert" : undefined}
        style={[styles.value, { color: missed ? ALERT : c.text, fontFamily: f.semibold }]}
      >
        {missed ? `+${formatCountdown(shown)}` : formatCountdown(shown)}
      </Text>
      <Text style={[styles.sub, { color: c.textSoft, fontFamily: f.regular }]}>
        {missed ? missedBody : state === "active" ? t("safety.autoAlert") : t("safety.setTarget")}
      </Text>
      {missed && missedStatus ? (
        <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]} accessibilityLiveRegion="polite">
          {missedStatus}
        </Text>
      ) : null}

      {state === "idle" ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetScroll} contentContainerStyle={styles.presets}>
            {presets.map((p) => (
              <AuraChip key={p.duration} label={p.label} selected={p.duration === plannedDuration} onPress={() => onSelectDuration(p.duration)} />
            ))}
          </ScrollView>
          <AuraButton label={t("safety.startDefault", { duration: plannedLabel })} icon="clock" onPress={onStart} style={styles.first} />
        </>
      ) : (
        <View style={styles.buttons}>
          {missed ? (
            <AuraButton label={t("safety.sendMissedAlert")} icon="messageCircle" variant="danger" loading={missedBusy} onPress={onSendMissedAlert} />
          ) : null}
          <AuraButton label={t("safety.imSafe")} icon="check" variant={missed ? "secondary" : "primary"} onPress={onCheckIn} />
          <AuraButton label={t("safety.extendOneHour")} icon="plus" variant="ghost" size="md" onPress={onExtend} />
        </View>
      )}
    </AuraCard>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13 },
  value: { fontSize: 44, letterSpacing: -1.5, fontVariant: ["tabular-nums"], marginTop: 2 },
  sub: { fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  presetScroll: { marginTop: 16, marginHorizontal: -18 },
  presets: { gap: 8, paddingHorizontal: 18 },
  first: { marginTop: 16 },
  buttons: { gap: 10, marginTop: 16 },
});
