import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraSection, Icon, PressableScale, useAura, type IconName } from "@/atoms";
import { mustDosAlong, useMustDoStore, useSavedSheetStore, type TripEvent } from "@/features/itinerary";
import { formatters } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { tripPrep } from "@/features/home/utils/tripPrep";
import type { HomeStop } from "@/features/home/types";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";

const GAP_ROWS = 2;

/**
 * "Before you go": the first booking, nights booked and the gaps between stays, then rows for saved
 * ideas and must-dos that open the Saved sheet. Only what exists is listed; with nothing, it's hidden.
 */
export function TripPrepCard({ trip, events, stops }: { trip: Trip; events: TripEvent[]; stops: HomeStop[] }) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const dismissed = useMustDoStore((state) => state.dismissed[trip.id]);
  const showSaved = useSavedSheetStore((state) => state.show);
  const format = formatters(locale, hour12);
  const prep = tripPrep(events, trip);
  const popular = mustDosAlong(stops, locale, [...events.map((event) => event.title), ...(dismissed ?? [])]);
  const mustDoCount = popular.reduce((sum, group) => sum + group.items.length, 0);
  const range = ([from, to]: [Date, Date]) =>
    from.getTime() === to.getTime() ? format.monthDay.format(from) : `${format.monthDay.format(from)} – ${format.monthDay.format(to)}`;

  const link = (icon: IconName, text: string, onPress: () => void) => (
    <PressableScale key={icon} onPress={onPress} accessibilityRole="button" style={styles.row}>
      <Icon name={icon} size={15} color={c.textSoft} />
      <Text numberOfLines={1} style={[styles.rowText, { color: c.text, fontFamily: f.medium }]}>
        {text}
      </Text>
      <Icon name="chevronRight" size={13} color={c.textMuted} />
    </PressableScale>
  );

  const row = (icon: IconName, text: string, tone: string, key: string) => (
    <View key={key} style={styles.row}>
      <Icon name={icon} size={15} color={tone} />
      <Text numberOfLines={1} style={[styles.rowText, { color: c.text, fontFamily: f.medium }]}>
        {text}
      </Text>
    </View>
  );

  const first = prep.first;
  if (!first && prep.bookedNights === 0 && mustDoCount === 0) return null;
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
        {mustDoCount > 0
          ? link(
              "star",
              popular.length === 1 ? t("home.prep.mustDos", { count: mustDoCount, place: popular[0].place }) : t("home.prep.mustDosRoute", { count: mustDoCount }),
              () => showSaved(trip.id, "popular", "must_dos"),
            )
          : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 24 },
  rows: { gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1, fontSize: 14 },
});
