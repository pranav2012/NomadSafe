import React, { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import {
  AuraButton,
  AuraCard,
  AuraEmptyState,
  AuraSkeletonGroup,
  AuraSkeletonRow,
  Icon,
  PressableScale,
  showAlert,
  useAura,
  AuraTopFade,
  type AuraAlertButton,
} from "@/atoms";
import { auraHitSlop, auraRadius, auraSignal } from "@/constants/aura";
import { distanceKm } from "@/features/home/components/aura/globe/sun";
import { readLastKnownFix } from "@/features/safety/services/lastKnownLocation";
import { useLocalization } from "@/localization";
import { PrivateView } from "@/modules/analytics";
import { AddPersonSheet } from "../components/AddPersonSheet";
import { CircleAvatar } from "../components/CircleAvatar";
import { useCircle } from "../hooks/useCircle";
import type { CirclePerson } from "../utils/circle";

const LIVE = auraSignal.ready;
const DANGER = auraSignal.danger;
const BACK_SIZE = 38;
const PILL_SLOP = { top: 5, bottom: 5, left: 4, right: 4 };

/** The people who get your alerts and see you while you share, plus requests from others. */
export default function CircleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, f, isDark } = useAura();
  const { t, formatTime, formatDistance } = useLocalization();
  const circle = useCircle();
  const [addOpen, setAddOpen] = useState(false);
  const [me] = useState(() => readLastKnownFix());

  const statusLine = (person: CirclePerson) => {
    const parts: string[] = [];
    if (person.status === "accepted") parts.push(t("circle.getsAlerts"));
    else if (person.status === "pending") parts.push(t("circle.pending"));
    else if (person.status === "declined") parts.push(t("circle.declined"));
    else if (person.status === "invited") parts.push(t("circle.invited"));
    if (person.location) {
      parts.push(t("circle.sharingSince", { time: formatTime(new Date(person.location.updatedAt)) }));
      if (me) parts.push(formatDistance(distanceKm(me, person.location)));
    } else if (person.status === "none") {
      parts.push(t("circle.notAdded"));
    }
    return parts.join(" · ");
  };

  const openPerson = (person: CirclePerson) => {
    const buttons: AuraAlertButton[] = [];
    const location = person.location;
    if (location) {
      buttons.push({
        text: t("sharing.openInMaps"),
        onPress: () => void Linking.openURL(`https://maps.google.com/?q=${location.latitude},${location.longitude}`).catch(() => {}),
      });
    }
    if (person.status === "invited") buttons.push({ text: t("sharing.sendInvite"), onPress: () => circle.sendInvite(person) });
    const email = person.email;
    if (person.status === "none" && email) {
      buttons.push({ text: t("circle.addBack"), onPress: () => void circle.add({ name: person.name, email }) });
    }
    if (person.linkId || person.inviteId) {
      buttons.push({ text: t("circle.remove"), style: "destructive", onPress: () => void circle.remove(person) });
    }
    buttons.push({ text: t("common.cancel"), style: "cancel" });
    showAlert(person.name, statusLine(person), buttons);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <PressableScale
          onPress={() => router.back()}
          hitSlop={auraHitSlop(BACK_SIZE)}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          style={[styles.back, { backgroundColor: c.surfaceStrong }]}
        >
          <Icon name="chevronLeft" size={18} color={c.text} />
        </PressableScale>
        <Text accessibilityRole="header" style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
          {t("circle.title")}
        </Text>
        <Text style={[styles.lede, { color: c.textSoft, fontFamily: f.regular }]}>{t("circle.lede")}</Text>

        <PrivateView>
          {circle.requests.length > 0 ? (
            <>
              <Text style={[styles.group, { color: c.textMuted, fontFamily: f.medium }]}>{t("circle.requestsTitle")}</Text>
              <AuraCard style={styles.list}>
                {circle.requests.map((req, i) => (
                  <View key={req.linkId} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }]}>
                    <CircleAvatar name={req.name} />
                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={[styles.name, { color: c.text, fontFamily: f.semibold }]}>{req.name}</Text>
                      <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>{t("circle.requestBody")}</Text>
                    </View>
                    <View style={styles.trailing}>
                      <Pill label={t("sharing.accept")} filled onPress={() => void circle.respond(req.linkId, true)} />
                      <Pill label={t("sharing.decline")} onPress={() => void circle.respond(req.linkId, false)} />
                    </View>
                  </View>
                ))}
              </AuraCard>
            </>
          ) : null}

          {!circle.loaded ? (
            <AuraSkeletonGroup>
              <AuraCard style={styles.list}>
                {[0, 1, 2].map((i) => (
                  <AuraSkeletonRow key={i} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }]} />
                ))}
              </AuraCard>
            </AuraSkeletonGroup>
          ) : circle.people.length === 0 ? (
            <AuraEmptyState icon="users" tone={LIVE} title={t("circle.emptyTitle")} body={t("circle.emptyBody")} style={styles.empty} />
          ) : (
            <AuraCard style={styles.list}>
              {circle.people.map((person, i) => {
                const location = person.location;
                return (
                  <PressableScale
                    key={person.key}
                    onPress={() => openPerson(person)}
                    pressedScale={0.99}
                    haptic={false}
                    accessibilityRole="button"
                    accessibilityLabel={`${person.name}, ${statusLine(person)}`}
                    style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }]}
                  >
                    <CircleAvatar
                      name={person.name}
                      sharing={!!location}
                      stale={location?.stale}
                      muted={person.status === "invited" || person.status === "declined"}
                    />
                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={[styles.name, { color: c.text, fontFamily: f.semibold }]}>{person.name}</Text>
                      <Text
                        numberOfLines={2}
                        style={[styles.sub, { color: person.status === "declined" ? DANGER : c.textMuted, fontFamily: f.regular }]}
                      >
                        {statusLine(person)}
                      </Text>
                    </View>
                    {person.status === "invited" ? (
                      <Pill label={t("sharing.invite")} onPress={() => circle.sendInvite(person)} />
                    ) : location?.battery != null ? (
                      <Text style={[styles.battery, { color: location.battery < 0.2 ? DANGER : c.textSoft, fontFamily: f.medium }]}>
                        {Math.round(location.battery * 100)}%
                      </Text>
                    ) : (
                      <Icon name="chevronRight" size={16} color={c.textMuted} />
                    )}
                  </PressableScale>
                );
              })}
            </AuraCard>
          )}
        </PrivateView>

        <AuraButton label={t("circle.addPerson")} icon="plus" onPress={() => setAddOpen(true)} style={styles.add} />
        <View style={styles.note}>
          <Icon name="bell" size={13} color={c.textMuted} />
          <Text style={[styles.noteText, { color: c.textMuted, fontFamily: f.regular }]}>{t("circle.howAlertsWork")}</Text>
        </View>
      </ScrollView>
      <AuraTopFade />

      <AddPersonSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={circle.add}
        onShareLink={circle.shareInviteLink}
        onResetLink={circle.resetInviteLink}
        existingEmails={new Set(circle.people.map((p) => p.email ?? ""))}
      />
    </View>
  );
}

function Pill({ label, filled, onPress }: { label: string; filled?: boolean; onPress: () => void }) {
  const { c, f } = useAura();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={PILL_SLOP}
      style={[styles.pill, { backgroundColor: filled ? c.inverse : c.surfaceStrong, borderColor: c.hairline }]}
    >
      <Text style={[styles.pillText, { color: filled ? c.onInverse : c.text, fontFamily: f.semibold }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  back: { width: BACK_SIZE, height: BACK_SIZE, borderRadius: BACK_SIZE / 2, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 34, letterSpacing: -1.2, marginTop: 18 },
  lede: { fontSize: 15, lineHeight: 22, marginTop: 6, marginBottom: 18 },
  group: { fontSize: 13, marginBottom: 8, marginLeft: 4 },
  list: { paddingVertical: 4, paddingHorizontal: 14, marginBottom: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 15.5 },
  sub: { fontSize: 12.5, lineHeight: 17 },
  trailing: { flexDirection: "row", gap: 8 },
  battery: { fontSize: 12.5, fontVariant: ["tabular-nums"] },
  pill: { height: 34, paddingHorizontal: 13, borderRadius: auraRadius.chip, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  pillText: { fontSize: 12.5 },
  empty: { marginBottom: 16 },
  add: { marginTop: 4 },
  note: { flexDirection: "row", gap: 8, marginTop: 16, paddingHorizontal: 4 },
  noteText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
});
