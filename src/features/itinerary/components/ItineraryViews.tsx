import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon, PressableScale, useAura } from "@/atoms";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { describe, describeEntry, formatters } from "@/features/itinerary/utils/entryText";
import { buildTimeline } from "@/features/itinerary/utils/timeline";

const DAY_MS = 86_400_000;

function TypeIcon({ event }: { event: TripEvent }) {
  const color = auraEventColors[event.type];
  return (
    <View style={[styles.icon, { backgroundColor: `${color}22` }]}>
      <Icon name={getEventTypeMeta(event.type).icon} size={16} color={color} />
    </View>
  );
}

/** Home's compact "what's next" card: one row per booking, tap to edit. */
export function UpNextList({ events, onPress }: { events: TripEvent[]; onPress: (event: TripEvent) => void }) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const format = formatters(locale, hour12);
  const [now] = useState(() => Date.now());

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      {events.map((event, index) => {
        const { title, sub } = describe(event, t, format, now);
        const inProgress = event.type === "stay" && event.endAt && new Date(event.startAt).getTime() <= now;
        const when = new Date(inProgress && event.endAt ? event.endAt : event.startAt);
        return (
          <PressableScale
            key={event.id}
            onPress={() => onPress(event)}
            pressedScale={0.98}
            accessibilityRole="button"
            style={[styles.row, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline } : null]}
          >
            <TypeIcon event={event} />
            <View style={styles.text}>
              <Text numberOfLines={1} style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
                {title}
              </Text>
              {sub ? (
                <Text numberOfLines={1} style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>
                  {sub}
                </Text>
              ) : null}
            </View>
            <View style={styles.when}>
              <Text style={[styles.whenDay, { color: c.text, fontFamily: f.medium }]}>{format.weekdayDay.format(when)}</Text>
              <Text style={[styles.whenTime, { color: c.textMuted, fontFamily: f.regular }]}>{format.time.format(when)}</Text>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Items planned for a day without a time (e.g. ideas picked for a day), in day order; tap to edit. */
export function PlannedList({ events, onPress }: { events: TripEvent[]; onPress: (event: TripEvent) => void }) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const format = formatters(locale, hour12);

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      {events.map((event, index) => (
        <PressableScale
          key={event.id}
          onPress={() => onPress(event)}
          pressedScale={0.98}
          accessibilityRole="button"
          style={[styles.row, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline } : null]}
        >
          <TypeIcon event={event} />
          <Text numberOfLines={1} style={[styles.title, styles.text, { color: c.text, fontFamily: f.semibold }]}>
            {localizeEventTitle(event.title, t)}
          </Text>
          <View style={styles.when}>
            <Text style={[styles.whenDay, { color: c.text, fontFamily: f.medium }]}>{format.weekdayDay.format(new Date(event.startAt))}</Text>
            <Text style={[styles.whenTime, { color: c.textMuted, fontFamily: f.regular }]}>{t("itinerary.anytime")}</Text>
          </View>
        </PressableScale>
      ))}
    </View>
  );
}

/** The full itinerary: wishlist ideas first, then each day, with stays shown once at check-in and check-out. */
export function TimelineList({
  events,
  tripStart,
  onPress,
}: {
  events: TripEvent[];
  tripStart: Date;
  onPress: (event: TripEvent) => void;
}) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const format = formatters(locale, hour12);
  const [now] = useState(() => Date.now());
  const sections = buildTimeline(events);
  const wishlist = events.filter((event) => event.timing === "wishlist");

  return (
    <ScrollView contentContainerStyle={styles.timeline} showsVerticalScrollIndicator={false}>
      {wishlist.length > 0 ? (
        <View style={styles.day}>
          <Text style={[styles.dayHeader, { color: c.textSoft, fontFamily: f.semibold }]}>{t("ideas.sheetTitle")}</Text>
          {wishlist.map((event) => (
            <PressableScale key={event.id} onPress={() => onPress(event)} pressedScale={0.98} accessibilityRole="button" style={[styles.entry, styles.idea, { borderColor: c.textMuted }]}>
              <View style={styles.ideaMark}>
                <Icon name="bookmark" size={14} color={c.textMuted} />
              </View>
              <TypeIcon event={event} />
              <Text numberOfLines={1} style={[styles.title, styles.text, { color: c.text, fontFamily: f.semibold }]}>
                {localizeEventTitle(event.title, t)}
              </Text>
            </PressableScale>
          ))}
        </View>
      ) : null}
      {sections.map((section) => {
        if (section.kind === "staying") {
          const range =
            section.from.getTime() === section.to.getTime()
              ? format.dayHeader.format(section.from)
              : `${format.monthDay.format(section.from)} – ${format.monthDay.format(section.to)}`;
          return (
            <View key={`staying-${section.event.id}-${section.from.getTime()}`} style={styles.staying}>
              <Icon name="building" size={13} color={c.textMuted} />
              <Text numberOfLines={1} style={[styles.stayingText, { color: c.textMuted, fontFamily: f.regular }]}>
                {range} · {t("itinerary.stayingAt", { name: localizeEventTitle(section.event.title, t) })}
              </Text>
            </View>
          );
        }
        const dayNumber = Math.round((section.day.getTime() - tripStart.getTime()) / DAY_MS) + 1;
        const past = section.day.getTime() + DAY_MS <= now;
        return (
          <View key={section.day.getTime()} style={[styles.day, { opacity: past ? 0.55 : 1 }]}>
            <Text style={[styles.dayHeader, { color: c.textSoft, fontFamily: f.semibold }]}>
              {format.dayHeader.format(section.day)}
              {dayNumber >= 1 ? ` · ${t("itinerary.dayNumber", { day: dayNumber })}` : ""}
            </Text>
            {section.entries.map((entry) => {
              const { title, sub } = describeEntry(entry, t, format, now);
              return (
                <PressableScale
                  key={`${entry.event.id}-${entry.role}`}
                  onPress={() => onPress(entry.event)}
                  pressedScale={0.98}
                  accessibilityRole="button"
                  style={styles.entry}
                >
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.entryTime, { color: c.textMuted, fontFamily: f.medium }]}>
                    {entry.event.timing === "anytime" ? t("itinerary.anytime") : format.time.format(new Date(entry.at))}
                  </Text>
                  <TypeIcon event={entry.event} />
                  <View style={[styles.text, { opacity: entry.event.doneAt ? 0.55 : 1 }]}>
                    <Text
                      numberOfLines={1}
                      style={[styles.title, { color: c.text, fontFamily: f.semibold, textDecorationLine: entry.event.doneAt ? "line-through" : "none" }]}
                    >
                      {title}
                    </Text>
                    {sub ? (
                      <Text numberOfLines={1} style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>
                        {sub}
                      </Text>
                    ) : null}
                  </View>
                </PressableScale>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15 },
  sub: { fontSize: 13 },
  when: { alignItems: "flex-end", gap: 2 },
  whenDay: { fontSize: 13, fontVariant: ["tabular-nums"] },
  whenTime: { fontSize: 12, fontVariant: ["tabular-nums"] },
  timeline: { paddingHorizontal: 20, paddingBottom: 16, gap: 18 },
  day: { gap: 6 },
  dayHeader: { fontSize: 13.5, marginBottom: 2 },
  entry: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  entryTime: { width: 58, fontSize: 12.5, fontVariant: ["tabular-nums"] },
  idea: { borderWidth: 1.2, borderStyle: "dashed", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9 },
  ideaMark: { width: 22, alignItems: "center" },
  staying: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 70 },
  stayingText: { flex: 1, fontSize: 12.5 },
});
