import React, { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Icon, PressableScale, useAura, type IconName } from "@/atoms";
import { auraEventColors, auraSignal } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { SELF_ID } from "@/features/expenses/utils/split";
import { TRANSIT_MODES, getEventTypeMeta, type EventType } from "@/features/itinerary/constants/eventTypes";
import type { MealWindows } from "@/features/itinerary/data/mealTimes";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { anytimeOnDay, livePlan, tonightStay } from "@/features/itinerary/utils/dayPlan";
import { dayEntries, dayShape, missingInfo, type DayGap, type DurationGuess, type MissingKind } from "@/features/itinerary/utils/dayShape";
import { describeEntry, formatters } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { isForEveryone, isForMe } from "@/features/itinerary/utils/people";
import type { TimelineEntry } from "@/features/itinerary/utils/timeline";
import { transitModeOf } from "@/features/itinerary/utils/transit";

// Rows place these side by side 10 pt apart, so the slop grows them vertically and only 5 pt sideways.
const ROUND_SLOP = { top: 6, bottom: 6, left: 5, right: 5 };
const CHECK_SLOP = { top: 10, bottom: 10, left: 5, right: 5 };
const MOVE_ICONS = { walk: "footprints", transit: "train", drive: "car" } as const;

type Entry = TimelineEntry<TripEvent>;
type Row = { kind: "mine"; entry: Entry; together: boolean } | { kind: "theirs"; entries: Entry[] };
export type FreeGap = Extract<DayGap, { kind: "free" }>;

function mapsUrl(event: TripEvent, title: string, city: string | undefined) {
  if (event.place) return `https://www.google.com/maps/search/?api=1&query=${event.place.latitude},${event.place.longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(city ? `${title}, ${city}` : title)}`;
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
 * One day of the trip: "anytime" to-dos, then the timed plan with a now marker, how long things take,
 * getting between them, free windows and open meals, and what's missing on each item; other people's
 * plans fold away and tonight's stay closes it. Ideas and must-dos sit below it (DayIdeas).
 */
export function DayPlan({
  events,
  day,
  now,
  city,
  meals,
  learned,
  homeCountry,
  placeFailedIds,
  onPress,
  onAdd,
  onToggleDone,
  onGap,
  ticketEventIds,
  onOpenTickets,
  onAskForTicket,
}: {
  events: TripEvent[];
  day: Date;
  now: Date;
  city?: string;
  meals: MealWindows;
  learned?: Partial<Record<EventType, number>>;
  homeCountry?: string | null;
  placeFailedIds: Set<string>;
  /** Items with tickets saved on this phone get a ticket button. */
  ticketEventIds: Set<string>;
  onOpenTickets: (eventId: string) => void;
  /** Shared trips: items only someone else holds a ticket for offer to ask them for it. */
  onAskForTicket?: (event: TripEvent) => void;
  onPress: (event: TripEvent) => void;
  onAdd: () => void;
  onToggleDone: (event: TripEvent) => void;
  /** A free window or open meal was tapped: suggest food or things to do there. */
  onGap?: (gap: FreeGap) => void;
}) {
  const { c, f, accent } = useAura();
  const { t, locale, hour12, formatDistance, formatApproxDuration, formatCountdown } = useLocalization();
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const format = formatters(locale, hour12);
  const nowMs = now.getTime();
  const anytime = anytimeOnDay(events, day).filter(isForMe);
  const timed = dayEntries(events, day);
  const rows = toRows(timed);
  const shape = dayShape(timed.filter((entry) => isForMe(entry.event)), { day, meals, learned, homeCountry });
  const durations = new Map(shape.items.map((item) => [item.key, item.duration]));
  const tonight = tonightStay(events, day);
  const current = livePlan(events, nowMs).current;
  const isNow = (entry: Entry) => current?.event.id === entry.event.id && current.role === entry.role;
  const nameOf = (person: string) => (person === SELF_ID ? t("itinerary.form.you") : person);
  const namesOf = (entry: Entry) => (entry.event.people ?? []).map(nameOf).join(", ");
  const missingOf = (event: TripEvent) => missingInfo(event, { hasTicket: ticketEventIds.has(event.id), placeFailed: placeFailedIds.has(event.id) });
  const clock = (ms: number) => format.time.format(new Date(ms));

  const durationLabel = (duration: DurationGuess | null | undefined) => {
    if (!duration || duration.minutes <= 0) return null;
    return duration.estimated ? formatApproxDuration(duration.minutes / 60) : formatCountdown(duration.minutes);
  };

  const travelLabel = (event: TripEvent) => {
    const travel = event.travel;
    if (!travel) return null;
    const parts = (["terminal", "gate", "platform", "coach", "seat"] as const).flatMap((field) => (travel[field] ? [t(`itinerary.travel.short.${field}`, { value: travel[field] })] : []));
    if (travel.boardingAt) parts.push(t("itinerary.travel.boards", { time: format.time.format(new Date(travel.boardingAt)) }));
    return parts.length > 0 ? parts.join(" · ") : null;
  };

  const doneCircle = (event: TripEvent) => (
    <PressableScale
      onPress={() => onToggleDone(event)}
      hitSlop={CHECK_SLOP}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: Boolean(event.doneAt) }}
      accessibilityLabel={t("itinerary.day.markDone", { title: localizeEventTitle(event.title, t) })}
      style={[styles.check, event.doneAt ? { backgroundColor: auraEventColors[event.type], borderColor: auraEventColors[event.type] } : { borderColor: c.textMuted }]}
    >
      {event.doneAt ? <Icon name="check" size={12} color={c.bg} /> : null}
    </PressableScale>
  );

  const roundButton = (icon: IconName, label: string, onPress: () => void, role: "link" | "button" = "button") => (
    <PressableScale onPress={onPress} accessibilityRole={role} accessibilityLabel={label} hitSlop={ROUND_SLOP} style={[styles.round, { backgroundColor: c.surfaceStrong }]}>
      <Icon name={icon} size={13} color={c.text} />
    </PressableScale>
  );

  const mapsButton = (event: TripEvent) => {
    if (event.type === "transit" || event.type === "note") return null;
    const title = localizeEventTitle(event.title, t);
    return roundButton(
      "mapPin",
      t("itinerary.day.openMaps", { place: title }),
      () => {
        track("today_action", { action: "maps" });
        void Linking.openURL(mapsUrl(event, title, city));
      },
      "link",
    );
  };

  const linkButton = (event: TripEvent) => {
    const url = event.link?.url;
    if (!url || event.link?.provider !== "web" || !/^https:\/\//i.test(url)) return null;
    return roundButton(
      "globe",
      t("itinerary.day.openLink"),
      () => {
        track("today_action", { action: "open_link" });
        void Linking.openURL(url).catch(() => {});
      },
      "link",
    );
  };

  const missingChips = (event: TripEvent) => {
    const missing = event.doneAt ? [] : missingOf(event);
    if (missing.length === 0) return null;
    return (
      <View style={styles.chips}>
        {missing.map((kind: MissingKind) => (
          <PressableScale
            key={kind}
            onPress={() => {
              track("today_action", { action: "fix_missing" });
              onPress(event);
            }}
            accessibilityRole="button"
            hitSlop={6}
            style={styles.missing}
          >
            <Icon name="plus" size={11} color={auraSignal.amber} />
            <Text style={[styles.missingText, { color: auraSignal.amber, fontFamily: f.semibold }]}>{t(`itinerary.missing.${kind}`)}</Text>
          </PressableScale>
        ))}
      </View>
    );
  };

  // The line through the day; `cap` trims it above the first item and below the last.
  const spine = (cap: { top?: boolean; bottom?: boolean; gap?: boolean } = {}) => (
    <View
      pointerEvents="none"
      style={[styles.spine, { backgroundColor: c.hairline }, cap.gap ? styles.spineInGap : null, cap.top ? styles.spineFromMiddle : null, cap.bottom ? styles.spineToMiddle : null]}
    />
  );

  const gapLine = (gap: DayGap, key: string, last: boolean) => {
    if (gap.kind === "free") {
      const range = `${clock(gap.from)}–${clock(gap.to)}`;
      const label = gap.meal ? t(`itinerary.gap.${gap.meal}`, { range }) : t("itinerary.gap.free", { range, duration: formatCountdown(gap.minutes) });
      const tint = gap.meal ? auraSignal.amber : accent;
      return (
        <View key={key} style={styles.gapRow}>
          {spine({ bottom: last, gap: true })}
          <PressableScale
            disabled={!onGap}
            onPress={() => {
              track("today_action", { action: gap.meal ? "meal_food" : "free_ideas" });
              onGap?.(gap);
            }}
            accessibilityRole={onGap ? "button" : undefined}
            style={[styles.free, { backgroundColor: c.surface }]}
          >
            <Icon name={gap.meal ? "utensils" : "sparkle"} size={13} color={tint} />
            <View style={styles.text}>
              <Text numberOfLines={1} style={[styles.freeText, { color: c.text, fontFamily: f.medium }]}>
                {label}
              </Text>
              {gap.bags ? <Text style={[styles.gapSub, { color: c.textMuted, fontFamily: f.regular }]}>{t("itinerary.gap.bags")}</Text> : null}
            </View>
            {onGap ? (
              <Text style={[styles.freeAction, { color: tint, fontFamily: f.semibold }]}>{gap.meal ? t("itinerary.gap.findFood") : t("itinerary.gap.ideas")}</Text>
            ) : null}
          </PressableScale>
        </View>
      );
    }
    const { icon, label, warn } =
      gap.kind === "move"
        ? {
            icon: MOVE_ICONS[gap.estimate.mode],
            label: t(gap.tight ? "itinerary.gap.tight" : `itinerary.gap.${gap.estimate.mode}`, {
              duration: formatApproxDuration(gap.estimate.minutes / 60),
              distance: formatDistance(gap.estimate.km),
            }),
            warn: gap.tight,
          }
        : gap.kind === "exit"
          ? { icon: "plane" as const, label: t("itinerary.gap.exit", { duration: formatApproxDuration(gap.minutes / 60) }), warn: false }
          : {
              icon: "clock" as const,
              label: t(gap.flight ? "itinerary.gap.boardFlight" : "itinerary.gap.boardGround", { duration: formatApproxDuration(gap.minutes / 60) }),
              warn: false,
            };
    return (
      <View key={key} style={styles.gapRow}>
        {spine({ bottom: last, gap: true })}
        <View style={styles.gap}>
          <Icon name={warn ? "alertTriangle" : icon} size={12} color={warn ? auraSignal.amber : c.textMuted} />
          <Text numberOfLines={1} style={[styles.gapText, { color: warn ? auraSignal.amber : c.textMuted, fontFamily: f.regular }]}>
            {label}
          </Text>
        </View>
      </View>
    );
  };

  const gapsAfter = (key: string, lastRow: boolean) => {
    const gaps = shape.after[key] ?? [];
    return gaps.map((gap, index) => gapLine(gap, `${key}-gap-${index}`, lastRow && index === gaps.length - 1));
  };

  const itemRow = (
    event: TripEvent,
    key: string,
    timeLabel: string,
    title: string,
    sub: string,
    options: { now?: boolean; past?: boolean; together?: boolean; first: boolean; last: boolean },
  ) => {
    const color = auraEventColors[event.type];
    const faded = Boolean(event.doneAt) || options.past;
    const extras = [durationLabel(durations.get(key)), event.type === "transit" ? travelLabel(event) : null].filter(Boolean);
    const subLine = [sub, ...extras].filter(Boolean).join(" · ");
    return (
      <PressableScale key={key} onPress={() => onPress(event)} pressedScale={0.98} accessibilityRole="button" accessibilityState={{ selected: options.now }} style={[styles.row, { opacity: faded ? 0.5 : 1 }]}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.time, { color: options.now ? color : c.textSoft, fontFamily: options.now ? f.semibold : f.medium }]}>
          {timeLabel}
        </Text>
        <View style={styles.node}>
          {spine({ top: options.first, bottom: options.last })}
          <View style={[styles.icon, { backgroundColor: c.bg }]}>
            <View style={[styles.iconFill, { backgroundColor: `${color}26`, borderColor: options.now ? color : "transparent" }]}>
              <Icon name={iconOf(event)} size={14} color={color} />
            </View>
          </View>
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
          {subLine ? (
            <Text numberOfLines={2} style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>
              {subLine}
            </Text>
          ) : null}
          {options.past ? null : missingChips(event)}
        </View>
        <View style={styles.actions}>
          {ticketEventIds.has(event.id) ? (
            roundButton("ticket", t("tickets.show"), () => onOpenTickets(event.id))
          ) : onAskForTicket && (event.ticketHolders ?? []).some((person) => person !== SELF_ID) ? (
            <PressableScale
              onPress={() => onAskForTicket(event)}
              accessibilityRole="button"
              accessibilityLabel={t("tickets.heldBy", { names: (event.ticketHolders ?? []).filter((person) => person !== SELF_ID).join(", ") })}
              hitSlop={ROUND_SLOP}
              style={[styles.round, styles.remote, { borderColor: c.textMuted }]}
            >
              <Icon name="ticket" size={13} color={c.textMuted} />
            </PressableScale>
          ) : (
            linkButton(event)
          )}
          {mapsButton(event)}
          {event.type === "stay" ? null : doneCircle(event)}
        </View>
      </PressableScale>
    );
  };

  const theirsRow = (entries: Entry[], first: boolean, last: boolean) => {
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
      <View key={key}>
        <PressableScale
          onPress={() => setOpenGroups((keys) => (open ? keys.filter((k) => k !== key) : [...keys, key]))}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.gapRow}
        >
          {spine({ top: first, bottom: last && !open, gap: true })}
          <View style={styles.gap}>
            <Icon name="users" size={12} color={c.textMuted} />
            <Text numberOfLines={1} style={[styles.gapText, { color: c.textMuted, fontFamily: f.medium }]}>
              {summary}
            </Text>
            <Icon name={open ? "chevronDown" : "chevronRight"} size={12} color={c.textMuted} />
          </View>
        </PressableScale>
        {open
          ? entries.map((entry, index) => {
              const { title, sub } = describeEntry(entry, t, format, nowMs);
              return itemRow(entry.event, `${entry.event.id}-${entry.role}-open`, format.time.format(new Date(entry.at)), title, [namesOf(entry), sub].filter(Boolean).join(" · "), {
                past: new Date(entry.at).getTime() < nowMs,
                first: false,
                last: last && index === entries.length - 1,
              });
            })
          : null}
      </View>
    );
  };

  if (anytime.length === 0 && timed.length === 0 && !tonight) {
    return (
      <View style={styles.emptyRow}>
        <Icon name="compass" size={15} color={c.textMuted} />
        <Text style={[styles.emptyText, { color: c.textSoft, fontFamily: f.medium }]}>{t("home.live.freeDay")}</Text>
        <PressableScale onPress={onAdd} accessibilityRole="button" hitSlop={8} style={styles.emptyAdd}>
          <Icon name="plus" size={13} color={accent} />
          <Text style={[styles.emptyAddText, { color: accent, fontFamily: f.semibold }]}>{t("itinerary.day.addStop")}</Text>
        </PressableScale>
      </View>
    );
  }

  const total = rows.length;
  return (
    <View>
      {anytime.length > 0 ? (
        <View style={styles.anytime}>
          <Text style={[styles.anytimeLabel, { color: c.textMuted, fontFamily: f.semibold }]}>{t("itinerary.anytime")}</Text>
          {anytime.map((event) => (
            <PressableScale key={`${event.id}-anytime`} onPress={() => onPress(event)} accessibilityRole="button" style={[styles.anytimeRow, { opacity: event.doneAt ? 0.5 : 1 }]}>
              {doneCircle(event)}
              <Text numberOfLines={1} style={[styles.anytimeText, { color: c.text, fontFamily: f.medium, textDecorationLine: event.doneAt ? "line-through" : "none" }]}>
                {localizeEventTitle(event.title, t)}
              </Text>
            </PressableScale>
          ))}
        </View>
      ) : null}
      {shape.before.map((gap, index) => gapLine(gap, `before-${index}`, false))}
      {rows.map((row, index) => {
        const first = index === 0 && shape.before.length === 0;
        const lastRow = index === total - 1 && !tonight;
        if (row.kind === "theirs") return theirsRow(row.entries, first, lastRow);
        const { entry } = row;
        const key = `${entry.event.id}-${entry.role}`;
        const { title, sub } = describeEntry(entry, t, format, nowMs);
        const hasGaps = (shape.after[key] ?? []).length > 0;
        return (
          <React.Fragment key={key}>
            {itemRow(entry.event, key, format.time.format(new Date(entry.at)), title, sub, {
              now: isNow(entry),
              past: !isNow(entry) && new Date(entry.at).getTime() < nowMs,
              together: row.together,
              first,
              last: lastRow && !hasGaps,
            })}
            {gapsAfter(key, lastRow)}
          </React.Fragment>
        );
      })}
      {tonight ? (
        <PressableScale onPress={() => onPress(tonight.event)} pressedScale={0.98} accessibilityRole="button" style={styles.row}>
          <Text style={[styles.time, { color: c.textMuted, fontFamily: f.medium }]}> </Text>
          <View style={styles.node}>
            {spine({ top: rows.length === 0, bottom: true })}
            <View style={[styles.icon, { backgroundColor: c.bg }]}>
              <View style={[styles.iconFill, styles.tonightIcon, { borderColor: c.hairline }]}>
                <Icon name="building" size={13} color={c.textSoft} />
              </View>
            </View>
          </View>
          <Text numberOfLines={1} style={[styles.tonightText, { color: c.textSoft, fontFamily: f.medium }]}>
            {t("home.live.tonightAt", { name: localizeEventTitle(tonight.event.title, t) })}
          </Text>
          <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>{t("home.live.nightOf", { night: tonight.night, total: tonight.nights })}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const TIME_W = 46;
const NODE_W = 34;

const styles = StyleSheet.create({
  emptyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  emptyText: { flex: 1, fontSize: 14 },
  emptyAdd: { flexDirection: "row", alignItems: "center", gap: 4 },
  emptyAddText: { fontSize: 13.5 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 8 },
  time: { width: TIME_W, paddingTop: 8, fontSize: 12.5, fontVariant: ["tabular-nums"] },
  node: { width: NODE_W, alignItems: "center", alignSelf: "stretch" },
  spine: { position: "absolute", top: -8, bottom: -8, left: NODE_W / 2 - 1, width: 2, borderRadius: 1 },
  spineInGap: { left: TIME_W + 8 + NODE_W / 2 - 1, top: 0, bottom: 0 },
  spineFromMiddle: { top: 16 },
  spineToMiddle: { bottom: undefined, height: 24 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  iconFill: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tonightIcon: { backgroundColor: "transparent" },
  text: { flex: 1, minWidth: 0, gap: 2, paddingTop: 2 },
  label: { fontSize: 10.5, letterSpacing: 0.8, textTransform: "uppercase" },
  title: { fontSize: 15 },
  sub: { fontSize: 12.5 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  missing: { flexDirection: "row", alignItems: "center", gap: 3 },
  missingText: { fontSize: 12 },
  round: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  remote: { borderWidth: 1, borderStyle: "dashed" },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  gapRow: { flexDirection: "row", paddingStart: TIME_W + 8, minHeight: 26 },
  gap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingStart: NODE_W + 8, paddingVertical: 4 },
  gapText: { flex: 1, fontSize: 12.5 },
  gapSub: { fontSize: 12 },
  free: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, marginStart: NODE_W + 8, marginVertical: 4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12 },
  freeText: { fontSize: 13 },
  freeAction: { fontSize: 12.5 },
  anytime: { gap: 6, marginBottom: 10 },
  anytimeLabel: { fontSize: 10.5, letterSpacing: 0.8, textTransform: "uppercase" },
  anytimeRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  anytimeText: { flex: 1, fontSize: 14.5 },
  tonightText: { flex: 1, fontSize: 13.5, paddingTop: 8 },
});
