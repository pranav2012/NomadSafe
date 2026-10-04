import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { useAura } from "@/components/aura/useAura";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { localizeEventDetail, localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { buildTimeline, nightsBetween, type TimelineEntry } from "@/features/itinerary/utils/timeline";

type Translate = (key: string, params?: Record<string, string | number>) => string;

const LEGACY_HEADS = new Set(["Check-in", "Check-out", "Departure", "Arrival"]);
const DAY_MS = 86_400_000;

function formatters(locale: string) {
  return {
    time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }),
    weekdayDay: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }),
    monthDay: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
    dayHeader: new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }),
  };
}

/** "Departure · BLR → NRT" (older events) or "BLR → NRT" → "BLR → NRT". */
function routeOf(detail: string | undefined): string {
  if (!detail) return "";
  const [head, ...rest] = detail.split(" · ");
  return LEGACY_HEADS.has(head) ? rest.join(" · ") : detail;
}

interface Described {
  title: string;
  sub: string;
}

/** Title and subtitle for one booking: stays show their dates and nights, flights their route and arrival. */
function describe(event: TripEvent, t: Translate, format: ReturnType<typeof formatters>, now: number): Described {
  const name = localizeEventTitle(event.title, t);
  if (event.type === "stay") {
    if (!event.endAt) return { title: name, sub: localizeEventDetail(event.detail, t) ?? t("itinerary.defaults.checkIn") };
    const end = new Date(event.endAt);
    const inProgress = new Date(event.startAt).getTime() <= now && now < end.getTime();
    return {
      title: name,
      sub: inProgress
        ? t("itinerary.stayingNow", { date: format.monthDay.format(end) })
        : `${format.monthDay.format(new Date(event.startAt))} → ${format.monthDay.format(end)} · ${t("itinerary.nights", { count: nightsBetween(event.startAt, event.endAt) })}`,
    };
  }
  if (event.type === "transit") {
    const route = routeOf(event.detail);
    const arrives = event.endAt ? t("itinerary.arrives", { time: format.time.format(new Date(event.endAt)) }) : null;
    return { title: route || name, sub: [route ? name : null, arrives].filter(Boolean).join(" · ") };
  }
  return { title: name, sub: localizeEventDetail(event.detail, t) ?? "" };
}

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
  const { t, locale } = useLocalization();
  const format = formatters(locale);
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

/** The full itinerary grouped by day, with stays shown once at check-in and check-out. */
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
  const { t, locale } = useLocalization();
  const format = formatters(locale);
  const [now] = useState(() => Date.now());
  const sections = buildTimeline(events);

  const entryLabel = (entry: TimelineEntry<TripEvent>): Described => {
    const name = localizeEventTitle(entry.event.title, t);
    if (entry.role === "check-in") {
      const nights = entry.event.endAt ? t("itinerary.nights", { count: nightsBetween(entry.event.startAt, entry.event.endAt) }) : null;
      return { title: name, sub: [t("itinerary.defaults.checkIn"), nights].filter(Boolean).join(" · ") };
    }
    if (entry.role === "check-out") return { title: name, sub: t("itinerary.defaults.checkOut") };
    return describe(entry.event, t, format, now);
  };

  return (
    <ScrollView contentContainerStyle={styles.timeline} showsVerticalScrollIndicator={false}>
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
              const { title, sub } = entryLabel(entry);
              return (
                <PressableScale
                  key={`${entry.event.id}-${entry.role}`}
                  onPress={() => onPress(entry.event)}
                  pressedScale={0.98}
                  accessibilityRole="button"
                  style={styles.entry}
                >
                  <Text style={[styles.entryTime, { color: c.textMuted, fontFamily: f.medium }]}>{format.time.format(new Date(entry.at))}</Text>
                  <TypeIcon event={entry.event} />
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
  staying: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 70 },
  stayingText: { flex: 1, fontSize: 12.5 },
});
