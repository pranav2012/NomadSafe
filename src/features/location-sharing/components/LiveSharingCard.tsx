import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Battery from "expo-battery";
import { useFocusEffect } from "expo-router";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraCard } from "@/components/aura/AuraCard";
import { AuraChip } from "@/components/aura/AuraChip";
import { useAura } from "@/components/aura/useAura";
import { Icon } from "@/components/nomad/Icon";
import { LiveDot } from "@/components/motion/LiveDot";
import { useLocalization } from "@/localization";
import { isLocationBroadcastRunning, readBroadcastState } from "../services/locationBroadcastTask";
import { getDrainPercentForMode, useSharingStore, type BroadcastMode } from "../store/sharingStore";

const MODES: { id: BroadcastMode; labelKey: string; subKey: string }[] = [
  { id: "normal", labelKey: "sharing.modeNormal", subKey: "sharing.modeNormalSub" },
  { id: "low", labelKey: "sharing.modeLow", subKey: "sharing.modeLowSub" },
  { id: "emergency", labelKey: "sharing.modeEmergency", subKey: "sharing.modeEmergencySub" },
];

const DANGER = "#FF4D5E";

interface LiveSharingCardProps {
  isBroadcasting: boolean;
  busy: boolean;
  mode: BroadcastMode;
  activeRecipientCount: number;
  accent: string;
  onToggle: () => void;
  onModeChange: (mode: BroadcastMode) => void;
}

/** Live location status, update interval and battery estimate, with start/stop. */
export function LiveSharingCard({ isBroadcasting, busy, mode, activeRecipientCount, accent, onToggle, onModeChange }: LiveSharingCardProps) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const setBroadcasting = useSharingStore((s) => s.setBroadcasting);
  const currentBattery = useSharingStore((s) => s.currentBattery);
  const setCurrentBattery = useSharingStore((s) => s.setCurrentBattery);
  const [info, setInfo] = useState(() => readBroadcastState());
  const [now, setNow] = useState(() => Date.now());

  // Re-sync with the real OS task on focus; it may have been stopped externally.
  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      isLocationBroadcastRunning().then((running) => {
        if (active && running !== useSharingStore.getState().isBroadcasting) setBroadcasting(running);
      });
      setInfo(readBroadcastState());
      return () => {
        active = false;
      };
    }, [setBroadcasting]),
  );

  useEffect(() => {
    let mounted = true;
    Battery.getBatteryLevelAsync()
      .then((level) => {
        if (mounted && level >= 0) setCurrentBattery(Math.round(level * 100));
      })
      .catch(() => {});
    const id = setInterval(() => {
      setNow(Date.now());
      setInfo(readBroadcastState());
    }, 15_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [setCurrentBattery]);

  const lastUpdate = info.lastPublishedAt ? formatAgo(now - info.lastPublishedAt, t) : t("sharing.neverUpdated");
  const drain = getDrainPercentForMode(mode);
  const remainingHours = currentBattery != null ? Math.max(0, Math.round(currentBattery / drain)) : null;
  const modeSub = t(MODES.find((m) => m.id === mode)?.subKey ?? "sharing.modeNormalSub");
  const drainText =
    remainingHours != null
      ? t("sharing.drainEstimate", { percent: drain, hours: remainingHours })
      : t("sharing.drainEstimateNoBattery", { percent: drain });

  return (
    <AuraCard tone={isBroadcasting ? accent : undefined}>
      <View style={styles.statusRow}>
        <LiveDot color={isBroadcasting ? accent : c.textMuted} active={isBroadcasting} />
        <Text style={[styles.status, { color: c.text, fontFamily: f.semibold }]} accessibilityLiveRegion="polite">
          {isBroadcasting ? t("sharing.liveStatus", { count: activeRecipientCount }) : t("sharing.notBroadcastingLabel")}
        </Text>
        {isBroadcasting ? (
          <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.medium }]}>
            {t("sharing.lastUpdate")} · {lastUpdate}
          </Text>
        ) : null}
      </View>

      <View style={styles.modes} accessibilityRole="radiogroup">
        {MODES.map((m) => (
          <AuraChip key={m.id} label={t(m.labelKey)} selected={mode === m.id} onPress={busy ? undefined : () => onModeChange(m.id)} />
        ))}
      </View>
      <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>
        {modeSub} · {drainText}
      </Text>

      {isBroadcasting && info.lastError ? (
        <View style={styles.inline}>
          <Icon name="alertTriangle" size={15} color={DANGER} />
          <Text style={[styles.inlineText, { color: DANGER, fontFamily: f.medium }]}>{t("sharing.publishFailed")}</Text>
        </View>
      ) : null}

      <AuraButton
        label={isBroadcasting ? t("sharing.stopBroadcasting") : t("sharing.startBroadcasting")}
        icon={isBroadcasting ? "pause" : "play"}
        variant={isBroadcasting ? "secondary" : "primary"}
        size="md"
        loading={busy}
        onPress={onToggle}
        style={styles.button}
      />

      <View style={styles.inline}>
        <Icon name="lock" size={13} color={c.textMuted} />
        <Text style={[styles.inlineText, styles.privacy, { color: c.textMuted, fontFamily: f.regular }]}>{t("sharing.privacyNote")}</Text>
      </View>
    </AuraCard>
  );
}

function formatAgo(ms: number, t: ReturnType<typeof useLocalization>["t"]) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return t("sharing.justNow");
  if (minutes < 60) return t("sharing.minutesShort", { count: minutes });
  return t("sharing.hoursShort", { count: Math.floor(minutes / 60) });
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  status: { fontSize: 16, flex: 1 },
  meta: { fontSize: 12.5, fontVariant: ["tabular-nums"] },
  modes: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  inline: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 12 },
  inlineText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  privacy: { fontSize: 12 },
  button: { marginTop: 16 },
});
