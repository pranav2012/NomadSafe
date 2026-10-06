import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, useAura, type IconName } from "@/atoms";
import { MustDoRow, mustDosNear, useEventsStore, useMustDoStore, type TripEvent } from "@/features/itinerary";
import { formatters } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { toWallClock } from "@/features/itinerary/utils/wallClock";
import { tripPrep } from "@/features/home/utils/tripPrep";
import type { HomeStop } from "@/features/home/types";
import type { Trip } from "@/features/trips/store/tripsStore";
import { fromDateKey } from "@/features/trips/utils/dates";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";

const MUST_DO_PICKS = 3;
const GAP_ROWS = 2;

/** Before the trip: the first booking, which nights still need a bed, and must-dos to save to the wishlist. */
export function TripPrepCard({ trip, events, firstStop }: { trip: Trip; events: TripEvent[]; firstStop?: HomeStop }) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const addEvent = useEventsStore((state) => state.addEvent);
  const dismissed = useMustDoStore((state) => state.dismissed[trip.id]);
  const dismiss = useMustDoStore((state) => state.dismiss);
  const format = formatters(locale, hour12);
  const prep = tripPrep(events, trip);
  const suggestions = firstStop ? mustDosNear(firstStop, locale, [...events.map((event) => event.title), ...(dismissed ?? [])]) : null;
  const range = ([from, to]: [Date, Date]) =>
    from.getTime() === to.getTime() ? format.monthDay.format(from) : `${format.monthDay.format(from)} – ${format.monthDay.format(to)}`;

  const row = (icon: IconName, text: string, tone: string, key: string) => (
    <View key={key} style={styles.row}>
      <Icon name={icon} size={15} color={tone} />
      <Text numberOfLines={1} style={[styles.rowText, { color: c.text, fontFamily: f.medium }]}>
        {text}
      </Text>
    </View>
  );

  const first = prep.first;
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
      <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("home.prep.title")}</Text>
      {first
        ? row(
            first.type === "stay" ? "building" : "plane",
            `${localizeEventTitle(first.title, t)} · ${format.dayHeader.format(new Date(first.startAt))}, ${format.time.format(new Date(first.startAt))}`,
            c.textSoft,
            "first",
          )
        : row("calendar", t("home.prep.noBookings"), c.textMuted, "first")}
      {prep.nights > 0
        ? row(
            "building",
            prep.bookedNights > 0 ? t("home.prep.nightsBooked", { booked: prep.bookedNights, count: prep.nights }) : t("home.prep.noStays"),
            prep.bookedNights === prep.nights ? c.textSoft : c.textMuted,
            "stays",
          )
        : null}
      {prep.gaps.slice(0, GAP_ROWS).map((gap) => row("alertTriangle", t("home.prep.gap", { range: range(gap) }), "#FFB547", `gap-${gap[0].getTime()}`))}
      {suggestions && suggestions.items.length > 0 ? (
        <View style={styles.mustDos}>
          <Text style={[styles.label, { color: c.textSoft, fontFamily: f.semibold }]}>{t("itinerary.mustDo.title", { place: suggestions.place })}</Text>
          {suggestions.items.slice(0, MUST_DO_PICKS).map((item) => (
            <MustDoRow
              key={item.key}
              item={item}
              actionLabel={t("home.prep.save")}
              onAdd={() => {
                track("must_do_suggestion", { action: "added", where: "trip_prep" });
                addEvent({ tripId: trip.id, type: item.type, title: item.name, startAt: toWallClock(fromDateKey(trip.startDate)), timing: "wishlist", source: "manual" });
              }}
              onDismiss={() => {
                track("must_do_suggestion", { action: "dismissed", where: "trip_prep" });
                dismiss(trip.id, item.key);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  title: { fontSize: 17, letterSpacing: -0.2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowText: { flex: 1, fontSize: 14 },
  mustDos: { gap: 10, marginTop: 4 },
  label: { fontSize: 11.5, letterSpacing: 0.8, textTransform: "uppercase" },
});
