import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, Icon, type IconName, LiveDot, PressableScale, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { CircleAvatar } from "@/features/location-sharing/components/CircleAvatar";
import type { CirclePerson } from "@/features/location-sharing/utils/circle";
import { useLocalization } from "@/localization";
import { useBriefPulse } from "../hooks/useBriefPulse";
import { formatCountdown, useSecondTicker } from "../utils/countdown";

const ALERT = auraStatusAccent.alert;
const WARN = "#FFB547";

/** Square action in the panel; lights up with the accent while its feature is running. */
export function SafetyTile({
  icon,
  label,
  sub,
  live = false,
  accent,
  tone,
  onPress,
}: {
  icon: IconName;
  label: string;
  sub: string;
  live?: boolean;
  accent: string;
  tone?: string;
  onPress: () => void;
}) {
  const { c, f } = useAura();
  const color = tone ?? (live ? accent : c.text);
  const pulse = useBriefPulse(live);
  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.95}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${sub}`}
      style={[styles.tile, { backgroundColor: live ? `${accent}1F` : c.surfaceStrong, borderColor: live ? `${accent}80` : c.hairline }]}
    >
      <View style={styles.tileHead}>
        <Icon name={icon} size={20} color={color} strokeWidth={1.9} />
        {live ? <LiveDot color={accent} size={7} active={pulse} /> : null}
      </View>
      <Text numberOfLines={2} style={[styles.tileLabel, { color: c.text, fontFamily: f.semibold }]}>
        {label}
      </Text>
      <Text numberOfLines={1} style={[styles.tileSub, { color: live ? accent : c.textMuted, fontFamily: f.medium }]}>
        {sub}
      </Text>
    </PressableScale>
  );
}

/** Running or missed safe-arrival timer with its live countdown and the I'm safe / +1 h actions. */
export function TimerLiveCard({
  missed,
  endsAt,
  accent,
  title,
  body,
  onSafe,
  onExtend,
}: {
  missed: boolean;
  endsAt: number;
  accent: string;
  title: string;
  body: string;
  onSafe: () => void;
  onExtend: () => void;
}) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const visible = useAnimationsActive();
  const now = useSecondTicker(visible);
  const tone = missed ? ALERT : accent;
  const seconds = missed ? Math.max(0, Math.floor((now - endsAt) / 1000)) : Math.max(0, Math.ceil((endsAt - now) / 1000));

  return (
    <View style={[styles.live, { backgroundColor: `${tone}17`, borderColor: `${tone}66` }]}>
      <View style={styles.liveHead}>
        <View style={styles.flex}>
          <Text style={[styles.liveTitle, { color: missed ? ALERT : c.textSoft, fontFamily: f.medium }]}>{title}</Text>
          <Text
            accessibilityRole={missed ? "alert" : undefined}
            style={[styles.count, { color: missed ? ALERT : c.text, fontFamily: f.semibold }]}
          >
            {missed ? `+${formatCountdown(seconds)}` : formatCountdown(seconds)}
          </Text>
        </View>
        <Icon name="clock" size={22} color={tone} />
      </View>
      <Text style={[styles.liveBody, { color: c.textSoft, fontFamily: f.regular }]}>{body}</Text>
      <View style={styles.liveButtons}>
        <AuraButton label={t("safety.imSafeShort")} icon="check" size="md" onPress={onSafe} style={styles.flex} />
        <AuraButton label={`+${t("safety.extendShort")}`} size="md" variant="secondary" onPress={onExtend} />
      </View>
    </View>
  );
}

/** Live sharing status: who sees you and until when, with Manage and Stop. */
export function SharingLiveCard({
  accent,
  title,
  body,
  error,
  busy,
  onManage,
  onStop,
}: {
  accent: string;
  title: string;
  body: string;
  error: string | null;
  busy: boolean;
  onManage: () => void;
  onStop: () => void;
}) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const pulse = useBriefPulse(true);
  return (
    <View style={[styles.live, { backgroundColor: `${accent}17`, borderColor: `${accent}66` }]}>
      <PressableScale onPress={onManage} haptic={false} pressedScale={0.99} accessibilityRole="button" style={styles.liveHead}>
        <LiveDot color={accent} active={pulse} />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.shareTitle, { color: c.text, fontFamily: f.semibold }]} accessibilityLiveRegion="polite">
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.liveBody, styles.tight, { color: c.textSoft, fontFamily: f.regular }]}>
            {body}
          </Text>
        </View>
        <AuraButton label={t("sharing.stopShort")} size="md" variant="secondary" loading={busy} onPress={onStop} />
      </PressableScale>
      {error ? (
        <View style={styles.error}>
          <Icon name="alertTriangle" size={14} color={ALERT} />
          <Text style={[styles.errorText, { color: ALERT, fontFamily: f.medium }]}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Avatars of the circle with how many get your alerts; a call to action while it's empty. */
export function CircleRow({ people, alertCount, onPress }: { people: CirclePerson[]; alertCount: number; onPress: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const empty = alertCount === 0;
  const shown = empty ? [] : people.slice(0, 4);
  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.98}
      accessibilityRole="button"
      style={[styles.circle, { backgroundColor: empty ? `${WARN}14` : c.surface, borderColor: empty ? `${WARN}55` : c.hairline }]}
    >
      {shown.length > 0 ? (
        <View style={styles.avatars}>
          {shown.map((person, i) => (
            <View key={person.key} style={[styles.avatarSlot, i > 0 && styles.overlap, { borderColor: c.card }]}>
              <CircleAvatar
                name={person.name}
                size={32}
                sharing={!!person.location}
                stale={person.location?.stale}
                muted={person.status !== "accepted" && person.status !== "none"}
              />
            </View>
          ))}
        </View>
      ) : (
        <View style={[styles.addIcon, { backgroundColor: `${WARN}26` }]}>
          <Icon name="plus" size={18} color={WARN} />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={[styles.circleTitle, { color: c.text, fontFamily: f.semibold }]}>
          {empty ? t("safety.circleEmptyTitle") : t("circle.title")}
        </Text>
        <Text numberOfLines={1} style={[styles.circleSub, { color: c.textMuted, fontFamily: f.regular }]}>
          {empty ? t("safety.circleEmptyBody") : t("safety.circleAlerts", { count: alertCount })}
        </Text>
      </View>
      <Icon name="chevronRight" size={16} color={c.textMuted} />
    </PressableScale>
  );
}

/** Shown only while some phone setting would stop alerts or sharing from working. */
export function FixBanner({ count, onPress }: { count: number; onPress: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  return (
    <PressableScale
      onPress={onPress}
      pressedScale={0.98}
      accessibilityRole="button"
      style={[styles.fix, { backgroundColor: `${WARN}14`, borderColor: `${WARN}55` }]}
    >
      <Icon name="alertTriangle" size={16} color={WARN} />
      <Text style={[styles.fixText, { color: c.text, fontFamily: f.medium }]}>{t("safety.fixBanner", { count })}</Text>
      <Icon name="chevronRight" size={16} color={c.textMuted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tile: { flex: 1, minHeight: 104, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 12, justifyContent: "space-between" },
  tileHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tileLabel: { fontSize: 13.5, lineHeight: 17, marginTop: 10 },
  tileSub: { fontSize: 12, marginTop: 3, fontVariant: ["tabular-nums"] },
  live: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 10 },
  liveHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  liveTitle: { fontSize: 12.5 },
  count: { fontSize: 34, letterSpacing: -1, fontVariant: ["tabular-nums"], marginTop: 1 },
  liveBody: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  tight: { marginTop: 1 },
  liveButtons: { flexDirection: "row", gap: 8, marginTop: 12 },
  shareTitle: { fontSize: 15 },
  error: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 10 },
  errorText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  circle: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 12, marginTop: 10 },
  avatars: { flexDirection: "row" },
  avatarSlot: { borderRadius: 18, borderWidth: 2 },
  overlap: { marginLeft: -10 },
  addIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  circleTitle: { fontSize: 14.5 },
  circleSub: { fontSize: 12.5, marginTop: 1 },
  fix: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 11, marginTop: 10 },
  fixText: { flex: 1, fontSize: 13.5 },
});
