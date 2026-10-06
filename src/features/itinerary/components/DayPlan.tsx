import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { AuraButton, Icon, PressableScale, useAura } from "@/atoms";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { TRANSIT_MODES, getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { entriesOnDay, tonightStay } from "@/features/itinerary/utils/dayPlan";
import { describeEntry, formatters } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import type { TimelineEntry } from "@/features/itinerary/utils/timeline";
import { transitModeOf } from "@/features/itinerary/utils/transit";

const OPEN_ENDED_MS = 60 * 60_000;

function mapsSearchUrl(place: string, city: string | undefined) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(city ? `${place}, ${city}` : place)}`;
}

/** One day of the trip: its items in order with a now marker, a Maps link per place, and tonight's stay. */
export function DayPlan({
  events,
  day,
  now,
  city,
  onPress,
  onAdd,
}: {
  events: TripEvent[];
  day: Date;
  now: Date;
  city?: string;
  onPress: (event: TripEvent) => void;
  onAdd: () => void;
}) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const format = formatters(locale, hour12);
  const nowMs = now.getTime();
  const entries = entriesOnDay(events, day);
  const tonight = tonightStay(events, day);

  const stateOf = (entry: TimelineEntry<TripEvent>, index: number): "past" | "now" | "next" => {
    const start = new Date(entry.at).getTime();
    if (start > nowMs) return "next";
    const following = entries[index + 1];
    const end =
      entry.role === "single" && entry.event.endAt
        ? new Date(entry.event.endAt).getTime()
        : Math.min(start + OPEN_ENDED_MS, following ? new Date(following.at).getTime() : Infinity);
    return entry.role === "single" && entry.event.type !== "stay" && nowMs < end ? "now" : "past";
  };

  if (entries.length === 0 && !tonight) {
    return (
      <View style={[styles.card, styles.free, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        <View style={styles.freeHead}>
          <View style={[styles.icon, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="compass" size={17} color={c.textSoft} />
          </View>
          <View style={styles.text}>
            <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("home.live.freeDay")}</Text>
            <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>{t("itinerary.day.freeBody")}</Text>
          </View>
        </View>
        <AuraButton size="md" variant="secondary" icon="plus" label={t("itinerary.day.addStop")} onPress={onAdd} style={styles.freeAction} />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      {entries.map((entry, index) => {
        const state = stateOf(entry, index);
        const { title, sub } = describeEntry(entry, t, format, nowMs);
        const color = auraEventColors[entry.event.type];
        const place = entry.event.type === "transit" ? null : localizeEventTitle(entry.event.title, t);
        const mode = transitModeOf(entry.event);
        const icon = TRANSIT_MODES.find((item) => item.id === mode)?.icon ?? getEventTypeMeta(entry.event.type).icon;
        return (
          <PressableScale
            key={`${entry.event.id}-${entry.role}`}
            onPress={() => onPress(entry.event)}
            pressedScale={0.98}
            accessibilityRole="button"
            accessibilityState={{ selected: state === "now" }}
            style={[styles.row, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline } : null, { opacity: state === "past" ? 0.5 : 1 }]}
          >
            <Text style={[styles.time, { color: state === "now" ? color : c.textMuted, fontFamily: state === "now" ? f.semibold : f.medium }]}>
              {format.time.format(new Date(entry.at))}
            </Text>
            <View style={[styles.icon, { backgroundColor: `${color}22`, borderColor: color, borderWidth: state === "now" ? 1.5 : 0 }]}>
              <Icon name={icon} size={16} color={color} />
            </View>
            <View style={styles.text}>
              {state === "now" ? <Text style={[styles.nowLabel, { color, fontFamily: f.semibold }]}>{t("home.live.now")}</Text> : null}
              <Text numberOfLines={1} style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
                {title}
              </Text>
              {sub ? (
                <Text numberOfLines={1} style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>
                  {sub}
                </Text>
              ) : null}
            </View>
            {place ? (
              <PressableScale
                onPress={() => {
                  track("today_action", { action: "maps" });
                  void Linking.openURL(mapsSearchUrl(place, city));
                }}
                accessibilityRole="link"
                accessibilityLabel={t("itinerary.day.openMaps", { place })}
                style={[styles.maps, { backgroundColor: c.surfaceStrong }]}
              >
                <Icon name="mapPin" size={14} color={c.text} />
              </PressableScale>
            ) : null}
          </PressableScale>
        );
      })}
      {tonight ? (
        <PressableScale
          onPress={() => onPress(tonight.event)}
          pressedScale={0.98}
          accessibilityRole="button"
          style={[styles.tonight, entries.length > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline } : null]}
        >
          <Icon name="building" size={14} color={c.textMuted} />
          <Text numberOfLines={1} style={[styles.tonightText, { color: c.textSoft, fontFamily: f.medium }]}>
            {t("home.live.tonightAt", { name: localizeEventTitle(tonight.event.title, t) })}
          </Text>
          <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>
            {t("home.live.nightOf", { night: tonight.night, total: tonight.nights })}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  free: { padding: 16, gap: 14 },
  freeHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  freeAction: { alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  time: { width: 56, fontSize: 12.5, fontVariant: ["tabular-nums"] },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  nowLabel: { fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" },
  title: { fontSize: 15 },
  sub: { fontSize: 13 },
  maps: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  tonight: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  tonightText: { flex: 1, fontSize: 13.5 },
});
