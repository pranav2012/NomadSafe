import React, { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { AuraButton, Icon, PressableScale, useAura, type IconName } from "@/atoms";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { SELF_ID } from "@/features/expenses/utils/split";
import { TRANSIT_MODES, getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { anytimeOnDay, entriesOnDay, livePlan, tonightStay, wishlistOf } from "@/features/itinerary/utils/dayPlan";
import { describeEntry, formatters } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { isForEveryone, isForMe } from "@/features/itinerary/utils/people";
import type { TimelineEntry } from "@/features/itinerary/utils/timeline";
import { transitModeOf } from "@/features/itinerary/utils/transit";

type Entry = TimelineEntry<TripEvent>;
type Row = { kind: "mine"; entry: Entry; together: boolean } | { kind: "theirs"; entries: Entry[] };

const WISHLIST_PICKS = 3;

function mapsSearchUrl(place: string, city: string | undefined) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(city ? `${place}, ${city}` : place)}`;
}

function iconOf(event: TripEvent): IconName {
  const mode = transitModeOf(event);
  return TRANSIT_MODES.find((item) => item.id === mode)?.icon ?? getEventTypeMeta(event.type).icon;
}

/** Your items as rows; runs of other people's items fold into one row, and the first shared item after one is "together again". */
function toRows(entries: Entry[]): Row[] {
  const rows: Row[] = [];
  for (const entry of entries) {
    const last = rows[rows.length - 1];
    if (!isForMe(entry.event)) {
      if (last?.kind === "theirs") last.entries.push(entry);
      else rows.push({ kind: "theirs", entries: [entry] });
      continue;
    }
    rows.push({ kind: "mine", entry, together: last?.kind === "theirs" && isForEveryone(entry.event) });
  }
  return rows;
}

/**
 * One day of the trip: "anytime" to-dos, then the timed plan with a now marker, Maps links and done
 * ticks; other people's plans fold away, tonight's stay closes it, and a free day offers wishlist picks.
 */
export function DayPlan({
  events,
  day,
  now,
  city,
  onPress,
  onAdd,
  onToggleDone,
  onSchedule,
}: {
  events: TripEvent[];
  day: Date;
  now: Date;
  city?: string;
  onPress: (event: TripEvent) => void;
  onAdd: () => void;
  onToggleDone: (event: TripEvent) => void;
  onSchedule: (event: TripEvent, day: Date) => void;
}) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const format = formatters(locale, hour12);
  const nowMs = now.getTime();
  const anytime = anytimeOnDay(events, day).filter(isForMe);
  const timed = entriesOnDay(events, day).filter((entry) => !entry.event.timing);
  const rows = toRows(timed);
  const tonight = tonightStay(events, day);
  const current = livePlan(events, nowMs).current;
  const isNow = (entry: Entry) => current?.event.id === entry.event.id && current.role === entry.role;
  const nameOf = (person: string) => (person === SELF_ID ? t("itinerary.form.you") : person);
  const namesOf = (entry: Entry) => (entry.event.people ?? []).map(nameOf).join(", ");

  const doneCircle = (event: TripEvent) => (
    <PressableScale
      onPress={() => onToggleDone(event)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: Boolean(event.doneAt) }}
      accessibilityLabel={t("itinerary.day.markDone", { title: localizeEventTitle(event.title, t) })}
      style={[styles.check, event.doneAt ? { backgroundColor: auraEventColors[event.type], borderColor: auraEventColors[event.type] } : { borderColor: c.textMuted }]}
    >
      {event.doneAt ? <Icon name="check" size={13} color={c.bg} /> : null}
    </PressableScale>
  );

  const mapsButton = (event: TripEvent) =>
    event.type === "transit" || event.type === "note" ? null : (
      <PressableScale
        onPress={() => {
          track("today_action", { action: "maps" });
          void Linking.openURL(mapsSearchUrl(localizeEventTitle(event.title, t), city));
        }}
        accessibilityRole="link"
        accessibilityLabel={t("itinerary.day.openMaps", { place: localizeEventTitle(event.title, t) })}
        style={[styles.round, { backgroundColor: c.surfaceStrong }]}
      >
        <Icon name="mapPin" size={14} color={c.text} />
      </PressableScale>
    );

  const itemRow = (
    event: TripEvent,
    key: string,
    timeLabel: string,
    title: string,
    sub: string,
    options: { now?: boolean; past?: boolean; together?: boolean; first: boolean },
  ) => {
    const color = auraEventColors[event.type];
    const faded = Boolean(event.doneAt) || options.past;
    return (
      <PressableScale
        key={key}
        onPress={() => onPress(event)}
        pressedScale={0.98}
        accessibilityRole="button"
        accessibilityState={{ selected: options.now }}
        style={[styles.row, options.first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }, { opacity: faded ? 0.5 : 1 }]}
      >
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.time, { color: options.now ? color : c.textMuted, fontFamily: options.now ? f.semibold : f.medium }]}>
          {timeLabel}
        </Text>
        <View style={[styles.icon, { backgroundColor: `${color}22`, borderColor: color, borderWidth: options.now ? 1.5 : 0 }]}>
          <Icon name={iconOf(event)} size={16} color={color} />
        </View>
        <View style={styles.text}>
          {options.now || options.together ? (
            <Text style={[styles.label, { color: options.now ? color : c.textSoft, fontFamily: f.semibold }]}>
              {options.now ? t("home.live.now") : t("itinerary.day.togetherAgain")}
            </Text>
          ) : null}
          <Text numberOfLines={1} style={[styles.title, { color: c.text, fontFamily: f.semibold, textDecorationLine: event.doneAt ? "line-through" : "none" }]}>
            {title}
          </Text>
          {sub ? (
            <Text numberOfLines={1} style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>
              {sub}
            </Text>
          ) : null}
        </View>
        {mapsButton(event)}
        {event.type === "stay" ? null : doneCircle(event)}
      </PressableScale>
    );
  };

  const theirsRow = (entries: Entry[], first: boolean) => {
    const key = `${entries[0].event.id}-${entries[0].role}`;
    const open = openGroups.includes(key);
    const lone = entries[0];
    const end = lone.event.endAt ? format.time.format(new Date(lone.event.endAt)) : null;
    const summary =
      entries.length === 1
        ? [namesOf(lone), describeEntry(lone, t, format, nowMs).title, end ? t("home.live.until", { time: end }) : format.time.format(new Date(lone.at))].join(" · ")
        : t("itinerary.day.splitUp", {
            from: format.time.format(new Date(entries[0].at)),
            to: format.time.format(new Date(entries[entries.length - 1].at)),
            count: entries.length,
            names: [...new Set(entries.map(namesOf))].join(", "),
          });
    return (
      <View key={key} style={first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }}>
        <PressableScale
          onPress={() => setOpenGroups((keys) => (open ? keys.filter((k) => k !== key) : [...keys, key]))}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.theirs}
        >
          <View style={[styles.spine, { backgroundColor: c.hairline }]} />
          <Icon name="users" size={13} color={c.textMuted} />
          <Text numberOfLines={1} style={[styles.theirsText, { color: c.textMuted, fontFamily: f.medium }]}>
            {summary}
          </Text>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={12} color={c.textMuted} />
        </PressableScale>
        {open
          ? entries.map((entry) => {
              const { title, sub } = describeEntry(entry, t, format, nowMs);
              return itemRow(entry.event, `${entry.event.id}-${entry.role}-open`, format.time.format(new Date(entry.at)), title, [namesOf(entry), sub].filter(Boolean).join(" · "), {
                past: new Date(entry.at).getTime() < nowMs,
                first: false,
              });
            })
          : null}
      </View>
    );
  };

  if (anytime.length === 0 && timed.length === 0 && !tonight) {
    const picks = wishlistOf(events).filter((event) => !event.doneAt).slice(0, WISHLIST_PICKS);
    return (
      <View style={[styles.card, styles.free, { backgroundColor: c.surface, borderColor: c.hairline }]}>
        <View style={styles.freeHead}>
          <View style={[styles.icon, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="compass" size={17} color={c.textSoft} />
          </View>
          <View style={styles.text}>
            <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("home.live.freeDay")}</Text>
            <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>
              {picks.length > 0 ? t("itinerary.day.freeBodyWishlist") : t("itinerary.day.freeBody")}
            </Text>
          </View>
        </View>
        {picks.map((event) => (
          <View key={event.id} style={styles.pick}>
            <Icon name={iconOf(event)} size={15} color={auraEventColors[event.type]} />
            <Text numberOfLines={1} style={[styles.pickTitle, { color: c.text, fontFamily: f.medium }]}>
              {localizeEventTitle(event.title, t)}
            </Text>
            <AuraButton size="md" variant="secondary" label={t("itinerary.day.addToDay")} onPress={() => onSchedule(event, day)} />
          </View>
        ))}
        <AuraButton size="md" variant="secondary" icon="plus" label={t("itinerary.day.addStop")} onPress={onAdd} style={styles.freeAction} />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      {anytime.map((event, index) => itemRow(event, `${event.id}-anytime`, t("itinerary.anytime"), localizeEventTitle(event.title, t), "", { first: index === 0 }))}
      {rows.map((row, index) => {
        const first = anytime.length === 0 && index === 0;
        if (row.kind === "theirs") return theirsRow(row.entries, first);
        const { entry } = row;
        const { title, sub } = describeEntry(entry, t, format, nowMs);
        return itemRow(entry.event, `${entry.event.id}-${entry.role}`, format.time.format(new Date(entry.at)), title, sub, {
          now: isNow(entry),
          past: !isNow(entry) && new Date(entry.at).getTime() < nowMs,
          together: row.together,
          first,
        });
      })}
      {tonight ? (
        <PressableScale
          onPress={() => onPress(tonight.event)}
          pressedScale={0.98}
          accessibilityRole="button"
          style={[styles.tonight, anytime.length + rows.length > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline } : null]}
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
  pick: { flexDirection: "row", alignItems: "center", gap: 10 },
  pickTitle: { flex: 1, fontSize: 14.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  time: { width: 54, fontSize: 12.5, fontVariant: ["tabular-nums"] },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" },
  title: { fontSize: 15 },
  sub: { fontSize: 13 },
  round: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  theirs: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 11, paddingStart: 40, paddingEnd: 14 },
  spine: { position: "absolute", left: 30, top: 0, bottom: 0, width: 2, borderRadius: 1 },
  theirsText: { flex: 1, fontSize: 13 },
  tonight: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  tonightText: { flex: 1, fontSize: 13.5 },
});
