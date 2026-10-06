import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraSection, AuraSheet, Icon, PressableScale, showToast, useAura, type IconName } from "@/atoms";
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

const GAP_ROWS = 2;

/**
 * "Before you go": the first booking, nights booked and the gaps between stays, and a must-dos row
 * that opens a sheet to save them to the wishlist. Only what exists is listed; with nothing, it's hidden.
 */
export function TripPrepCard({ trip, events, firstStop }: { trip: Trip; events: TripEvent[]; firstStop?: HomeStop }) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const addEvent = useEventsStore((state) => state.addEvent);
  const dismissed = useMustDoStore((state) => state.dismissed[trip.id]);
  const dismiss = useMustDoStore((state) => state.dismiss);
  const [mustDosOpen, setMustDosOpen] = useState(false);
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
  const hasMustDos = Boolean(suggestions && suggestions.items.length > 0);
  if (!first && prep.bookedNights === 0 && !hasMustDos) return null;
  return (
    <View>
      <AuraSection title={t("home.prep.title")} style={styles.section} />
      <View style={styles.rows}>
        {first
          ? row(
              first.type === "stay" ? "building" : "plane",
              `${localizeEventTitle(first.title, t)} · ${format.dayHeader.format(new Date(first.startAt))}, ${format.time.format(new Date(first.startAt))}`,
              c.textSoft,
              "first",
            )
          : null}
        {prep.bookedNights > 0
          ? row(
              "building",
              t("home.prep.nightsBooked", { booked: prep.bookedNights, count: prep.nights }),
              prep.bookedNights === prep.nights ? c.textSoft : c.textMuted,
              "stays",
            )
          : null}
        {prep.gaps.slice(0, GAP_ROWS).map((gap) => row("alertTriangle", t("home.prep.gap", { range: range(gap) }), "#FFB547", `gap-${gap[0].getTime()}`))}
        {suggestions && hasMustDos ? (
          <PressableScale onPress={() => setMustDosOpen(true)} accessibilityRole="button" style={styles.row}>
            <Icon name="star" size={15} color={c.textSoft} />
            <Text numberOfLines={1} style={[styles.rowText, { color: c.text, fontFamily: f.medium }]}>
              {t("home.prep.mustDos", { count: suggestions.items.length, place: suggestions.place })}
            </Text>
            <Icon name="chevronRight" size={13} color={c.textMuted} />
          </PressableScale>
        ) : null}
      </View>
      <AuraSheet
        visible={mustDosOpen && Boolean(suggestions?.items.length)}
        onClose={() => setMustDosOpen(false)}
        title={suggestions ? t("itinerary.mustDo.title", { place: suggestions.place }) : undefined}
        subtitle={trip.name}
      >
        <View style={styles.mustDos}>
          {suggestions?.items.map((item) => (
            <MustDoRow
              key={item.key}
              item={item}
              actionLabel={t("home.prep.save")}
              onAdd={() => {
                track("must_do_suggestion", { action: "added", where: "trip_prep" });
                addEvent({ tripId: trip.id, type: item.type, title: item.name, startAt: toWallClock(fromDateKey(trip.startDate)), timing: "wishlist", source: "manual" });
                showToast(t("home.prep.savedTitle"), t("home.prep.savedBody", { name: item.name }));
              }}
              onDismiss={() => {
                track("must_do_suggestion", { action: "dismissed", where: "trip_prep" });
                dismiss(trip.id, item.key);
              }}
            />
          ))}
        </View>
      </AuraSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24 },
  rows: { gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1, fontSize: 14 },
  mustDos: { gap: 16, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
});
