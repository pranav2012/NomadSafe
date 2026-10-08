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

/**
 * No items yet. Follows the Gmail booking sync (connect, checking, nothing found or failed); before
 * the trip (`preview`) it also shows a faded sample day and what adding bookings gives you.
 */
export function ItineraryEmpty({ trip, preview, onAdd, onScreenshot }: { trip: Trip; preview?: boolean; onAdd: () => void; onScreenshot: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const gmail = useGmailStatus();
  const { connect, ready } = useGmailImport();
  const progressLabel = useGmailProgressLabel(trip.id);
  const sync = useTripGmailSyncStatus(trip.id).state;

  const syncing = gmail.connected && sync === "syncing";
  const title = preview ? t("itinerary.preview.title") : gmail.connected && sync === "done" ? t("itinerary.noneFoundTitle") : t("itinerary.emptyTitle");
  const body = !gmail.configured
    ? t("itinerary.emptyManual")
    : !gmail.connected
      ? t("itinerary.emptyConnect")
      : syncing
        ? (progressLabel ?? t("itinerary.syncing"))
        : sync === "failed"
          ? t("itinerary.syncFailed")
          : t("itinerary.noneFoundBody");

  return (
    <View style={[styles.empty, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      {preview ? (
        <View style={styles.sample} accessible accessibilityLabel={t("itinerary.preview.sampleLabel")}>
          {SAMPLE.map((row) =>
            row.gap ? (
              <View key={row.key} style={[styles.sampleGap, row.key === "free" ? { backgroundColor: c.surfaceStrong } : null]}>
                <Icon name={row.icon} size={12} color={row.color || c.textMuted} />
                <Text numberOfLines={1} style={[styles.sampleGapText, { color: c.textMuted, fontFamily: f.regular }]}>
                  {t(`itinerary.preview.${row.key}`)}
                </Text>
              </View>
            ) : (
              <View key={row.key} style={styles.sampleRow}>
                <Text style={[styles.sampleTime, { color: c.textMuted, fontFamily: f.medium }]}>{row.time}</Text>
                <View style={[styles.sampleIcon, { backgroundColor: `${row.color}22` }]}>
                  <Icon name={row.icon} size={14} color={row.color} />
                </View>
                <Text numberOfLines={1} style={[styles.sampleTitle, { color: c.text, fontFamily: f.semibold }]}>
                  {t(`itinerary.preview.${row.key}`)}
                </Text>
              </View>
            ),
          )}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.surface, opacity: 0.35 }]} />
        </View>
      ) : null}
      <PressableScale onPress={onAdd} pressedScale={0.98} accessibilityRole="button" accessibilityHint={t("itinerary.form.addTitle")} style={styles.emptyHead}>
        <View style={[styles.emptyIcon, { backgroundColor: c.surfaceStrong }]}>
          {syncing ? <ActivityIndicator size="small" color={c.textSoft} /> : <Icon name="calendar" size={18} color={c.textSoft} />}
        </View>
        <View style={styles.flex}>
          <Text style={[styles.emptyTitle, { color: c.text, fontFamily: f.semibold }]}>{title}</Text>
          <Text style={[styles.emptyText, { color: c.textSoft, fontFamily: f.regular }]} accessibilityLiveRegion="polite">
            {preview ? t("itinerary.preview.body") : body}
          </Text>
          {preview && gmail.configured && (syncing || sync === "failed" || (gmail.connected && sync === "done")) ? (
            <Text style={[styles.emptyText, { color: c.textMuted, fontFamily: f.regular }]}>{body}</Text>
          ) : null}
        </View>
      </PressableScale>
      <View style={styles.actions}>
        {gmail.configured && !syncing ? (
          <AuraButton
            size="md"
            variant={gmail.connected ? "secondary" : "primary"}
            icon="mail"
            label={gmail.connected ? t("itinerary.scanAgain") : t("expenses.gmailConnect")}
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

const styles = StyleSheet.create({
  empty: { gap: 14, padding: auraSpace.cardPad, borderRadius: auraRadius.card, borderWidth: StyleSheet.hairlineWidth },
  emptyHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  emptyIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: auraType.bodyStrong },
  emptyText: { fontSize: 13.5, lineHeight: 19, marginTop: 2, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sample: { gap: 4, paddingBottom: 4 },
  sampleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  sampleTime: { width: 44, fontSize: 12, fontVariant: ["tabular-nums"] },
  sampleIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  sampleTitle: { flex: 1, fontSize: 14 },
  sampleGap: { flexDirection: "row", alignItems: "center", gap: 8, marginStart: 54, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  sampleGapText: { flex: 1, fontSize: 12.5 },
  flex: { flex: 1 },
});
