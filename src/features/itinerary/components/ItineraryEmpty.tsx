import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AuraButton, Icon, PressableScale, useAura, type IconName } from "@/atoms";
import { auraEventColors, auraRadius, auraSignal, auraSpace, auraType } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { useGmailImport } from "@/features/expenses/hooks/useGmailImport";
import { useGmailProgressLabel, useGmailStatus } from "@/features/expenses/hooks/useGmailStatus";
import { syncTripGmail } from "@/features/expenses/services/tripGmailSync";
import { useTripGmailSyncStatus } from "@/features/expenses/store/gmailSyncStatusStore";
import type { Trip } from "@/features/trips/store/tripsStore";

const SAMPLE: { time: string; icon: IconName; color: string; key: string; gap?: boolean }[] = [
  { time: "07:40", icon: "plane", color: auraEventColors.transit, key: "land" },
  { time: "", icon: "car", color: "", key: "ride", gap: true },
  { time: "", icon: "utensils", color: auraSignal.amber, key: "free", gap: true },
  { time: "15:00", icon: "building", color: auraEventColors.stay, key: "hotel" },
];

/** A ghost sample day (dashed, muted, badged "Example") so it never reads as the user's own data. */
function SampleDay() {
  const { c, f } = useAura();
  const { t } = useLocalization();
  return (
    <View style={[styles.sample, { borderColor: c.textMuted }]} accessible accessibilityLabel={t("itinerary.preview.sampleLabel")}>
      <View style={[styles.badge, { backgroundColor: c.surfaceStrong }]}>
        <Icon name="info" size={11} color={c.textSoft} />
        <Text style={[styles.badgeText, { color: c.textSoft, fontFamily: f.semibold }]}>{t("itinerary.preview.badge")}</Text>
      </View>
      <View style={styles.ghost}>
        {SAMPLE.map((row, index) => (
          <React.Fragment key={row.key}>
            {index > 0 ? (
              <View style={styles.connector}>
                {[0, 1, 2].map((dot) => (
                  <View key={dot} style={[styles.dot, { backgroundColor: c.textMuted }]} />
                ))}
              </View>
            ) : null}
            <View style={styles.sampleRow}>
              <Text style={[styles.sampleTime, { color: c.textMuted, fontFamily: f.medium }]}>{row.time}</Text>
              <View style={styles.nodeCol}>
                <View style={[row.gap ? styles.gapNode : styles.node, { borderColor: row.gap ? "transparent" : c.textMuted }]}>
                  <Icon name={row.icon} size={row.gap ? 12 : 14} color={row.color || c.textMuted} />
                </View>
              </View>
              <Text
                numberOfLines={1}
                style={[
                  row.gap ? styles.sampleGapText : styles.sampleTitle,
                  { color: row.gap ? c.textMuted : c.textSoft, fontFamily: row.gap ? f.regular : f.semibold },
                ]}
              >
                {t(`itinerary.preview.${row.key}`)}
              </Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

/**
 * No items yet. Follows the Gmail booking sync (connect, checking, nothing found or failed); before
 * the trip (`preview`) it shows a clearly labelled example day above the real ways to add bookings.
 */
export function ItineraryEmpty({ trip, preview, onAdd, onScreenshot }: { trip: Trip; preview?: boolean; onAdd: () => void; onScreenshot: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const gmail = useGmailStatus();
  const { connect, ready } = useGmailImport();
  const progressLabel = useGmailProgressLabel(trip.id);
  const sync = useTripGmailSyncStatus(trip.id).state;

  const syncing = gmail.connected && sync === "syncing";
  const title = preview ? t("itinerary.preview.heading") : gmail.connected && sync === "done" ? t("itinerary.noneFoundTitle") : t("itinerary.emptyTitle");
  const body = !gmail.configured
    ? t("itinerary.emptyManual")
    : !gmail.connected
      ? t("itinerary.emptyConnect")
      : syncing
        ? (progressLabel ?? t("itinerary.syncing"))
        : sync === "failed"
          ? t("itinerary.syncFailed")
          : t("itinerary.noneFoundBody");
  const gmailLabel = !gmail.connected ? t("expenses.gmailConnect") : preview && sync !== "done" ? t("itinerary.preview.gmail") : t("itinerary.scanAgain");

  return (
    <View style={[styles.empty, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <PressableScale onPress={onAdd} pressedScale={0.98} accessibilityRole="button" accessibilityHint={t("itinerary.form.addTitle")} style={styles.emptyHead}>
        <View style={[styles.emptyIcon, { backgroundColor: c.surfaceStrong }]}>
          {syncing ? <ActivityIndicator size="small" color={c.textSoft} /> : <Icon name="calendar" size={18} color={c.textSoft} />}
        </View>
        <View style={styles.flex}>
          <Text style={[styles.emptyTitle, { color: c.text, fontFamily: f.semibold }]}>{title}</Text>
          <Text style={[styles.emptyText, { color: c.textSoft, fontFamily: f.regular }]} accessibilityLiveRegion="polite">
            {preview ? t("itinerary.preview.body") : body}
          </Text>
        </View>
      </PressableScale>
      {preview ? <SampleDay /> : null}
      {preview && gmail.configured && (syncing || sync === "failed" || (gmail.connected && sync === "done")) ? (
        <Text style={[styles.emptyText, { color: c.textMuted, fontFamily: f.regular }]} accessibilityLiveRegion="polite">
          {body}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {gmail.configured && !syncing ? (
          <AuraButton
            size="md"
            variant={gmail.connected ? "secondary" : "primary"}
            icon="mail"
            label={gmailLabel}
            disabled={!gmail.connected && !ready}
            onPress={() => void (gmail.connected ? syncTripGmail(trip).catch(() => undefined) : connect())}
          />
        ) : null}
        <AuraButton size="md" variant="secondary" icon="camera" label={t("itinerary.preview.screenshot")} onPress={onScreenshot} />
        <AuraButton size="md" variant="secondary" icon="plus" label={t("itinerary.preview.add")} onPress={onAdd} />
      </View>
    </View>
  );
}

const NODE = 28;

const styles = StyleSheet.create({
  empty: { gap: 14, padding: auraSpace.cardPad, borderRadius: auraRadius.card, borderWidth: StyleSheet.hairlineWidth },
  emptyHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  emptyIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: auraType.bodyStrong },
  emptyText: { fontSize: 13.5, lineHeight: 19, marginTop: 2, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sample: { borderWidth: 1, borderStyle: "dashed", borderRadius: auraRadius.tile, padding: auraSpace.md, paddingTop: auraSpace.sm, gap: auraSpace.xs },
  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, height: 22, paddingHorizontal: 8, borderRadius: auraRadius.pill },
  badgeText: { fontSize: auraType.micro, letterSpacing: 0.6, textTransform: "uppercase" },
  ghost: { opacity: 0.75 },
  sampleRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: NODE },
  sampleTime: { width: 40, fontSize: auraType.caption, fontVariant: ["tabular-nums"] },
  nodeCol: { width: NODE, alignItems: "center" },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  gapNode: { width: NODE, height: 20, alignItems: "center", justifyContent: "center" },
  connector: { width: NODE, marginStart: 50, alignItems: "center", gap: 3, paddingVertical: 2 },
  dot: { width: 2, height: 2, borderRadius: 1, opacity: 0.6 },
  sampleTitle: { flex: 1, fontSize: 14 },
  sampleGapText: { flex: 1, fontSize: 12.5, fontStyle: "italic" },
  flex: { flex: 1 },
});
