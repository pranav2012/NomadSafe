import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, PressableScale, useAura, type IconName } from "@/atoms";
import { auraEventColors, auraSignal } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { TRANSIT_MODES } from "@/features/itinerary/constants/eventTypes";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { dayEntries, travelPlan } from "@/features/itinerary/utils/dayShape";
import { formatters, routeOf } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { isForMe } from "@/features/itinerary/utils/people";
import { transitModeOf } from "@/features/itinerary/utils/transit";
import { TRAVEL_FIELDS } from "@/features/itinerary/utils/travelDetails";

const SHOW_AFTER_DEPARTURE_MS = 60 * 60_000;

/**
 * Travel days: each of your departures that day with its times, terminal / gate / platform / coach /
 * seat when known (a nudge to add them otherwise), when to leave and when boarding starts. All from
 * the booking or what you typed; nothing is fetched live.
 */
export function TravelDayCard({
  events,
  day,
  now,
  homeCountry,
  ticketEventIds,
  onOpenTicket,
  onEdit,
}: {
  events: TripEvent[];
  day: Date;
  now: Date;
  homeCountry: string | null;
  ticketEventIds: Set<string>;
  onOpenTicket: (eventId: string) => void;
  onEdit: (event: TripEvent) => void;
}) {
  const { c, f } = useAura();
  const { t, locale, hour12, formatApproxDuration } = useLocalization();
  const format = formatters(locale, hour12);
  const departures = dayEntries(events, day).filter((entry) => {
    const mode = transitModeOf(entry.event);
    return (
      entry.role === "single" &&
      entry.event.type === "transit" &&
      mode !== undefined &&
      mode !== "car" &&
      isForMe(entry.event) &&
      !entry.event.doneAt &&
      new Date(entry.at).getTime() + SHOW_AFTER_DEPARTURE_MS > now.getTime()
    );
  });
  if (departures.length === 0) return null;

  return (
    <View style={styles.list}>
      {departures.map(({ event }) => {
        const mode = transitModeOf(event)!;
        const icon: IconName = TRANSIT_MODES.find((item) => item.id === mode)?.icon ?? "car";
        const color = auraEventColors.transit;
        const plan = travelPlan(events, event, homeCountry);
        const route = routeOf(event.detail);
        const title = localizeEventTitle(event.title, t);
        const lands = event.endAt ? new Date(event.endAt) : null;
        const nextDay = lands && lands.toDateString() !== new Date(event.startAt).toDateString();
        const details = TRAVEL_FIELDS.flatMap((field) => (event.travel?.[field] ? [{ field, value: event.travel[field]! }] : []));
        const wanted = mode === "flight" ? ["gate", "seat"] : ["platform", "seat"];
        const missing = wanted.filter((field) => !event.travel?.[field as keyof typeof event.travel]);
        return (
          <View key={event.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            <View style={styles.head}>
              <View style={[styles.icon, { backgroundColor: `${color}22` }]}>
                <Icon name={icon} size={17} color={color} />
              </View>
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
                  {route || title}
                </Text>
                <Text numberOfLines={1} style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>
                  {[route ? title : null, event.bookingRef ? t("itinerary.travel.booking", { ref: event.bookingRef }) : null].filter(Boolean).join(" · ")}
                </Text>
              </View>
              {ticketEventIds.has(event.id) ? (
                <PressableScale
                  onPress={() => {
                    track("today_action", { action: "show_travel" });
                    onOpenTicket(event.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("tickets.show")}
                  style={[styles.ticket, { backgroundColor: c.surfaceStrong }]}
                >
                  <Icon name="ticket" size={14} color={c.text} />
                  <Text style={[styles.ticketText, { color: c.text, fontFamily: f.semibold }]}>{t("itinerary.travel.ticket")}</Text>
                </PressableScale>
              ) : null}
            </View>

            <View style={styles.times}>
              <View style={styles.flex}>
                <Text style={[styles.caption, { color: c.textMuted, fontFamily: f.medium }]}>{t("itinerary.travel.departs")}</Text>
                <Text style={[styles.time, { color: c.text, fontFamily: f.semibold }]}>{format.time.format(new Date(plan.departAt))}</Text>
              </View>
              {lands ? (
                <View style={styles.flex}>
                  <Text style={[styles.caption, { color: c.textMuted, fontFamily: f.medium }]}>{t("itinerary.travel.arrives")}</Text>
                  <Text style={[styles.time, { color: c.text, fontFamily: f.semibold }]}>
                    {format.time.format(lands)}
                    {nextDay ? <Text style={[styles.plus, { color: c.textMuted }]}> +1</Text> : null}
                  </Text>
                </View>
              ) : null}
              {plan.boardingAt !== null ? (
                <View style={styles.flex}>
                  <Text style={[styles.caption, { color: c.textMuted, fontFamily: f.medium }]}>{t("itinerary.travel.boarding")}</Text>
                  <Text style={[styles.time, { color: c.text, fontFamily: f.semibold }]}>
                    {plan.boardingEstimated ? "~" : ""}
                    {format.time.format(new Date(plan.boardingAt))}
                  </Text>
                </View>
              ) : null}
            </View>

            {details.length > 0 || missing.length > 0 ? (
              <View style={styles.details}>
                {details.map(({ field, value }) => (
                  <View key={field} style={[styles.detail, { backgroundColor: c.surfaceStrong }]}>
                    <Text style={[styles.detailLabel, { color: c.textMuted, fontFamily: f.medium }]}>{t(`itinerary.travel.${field}`)}</Text>
                    <Text style={[styles.detailValue, { color: c.text, fontFamily: f.semibold }]}>{value}</Text>
                  </View>
                ))}
                {missing.length > 0 ? (
                  <PressableScale
                    onPress={() => {
                      track("today_action", { action: "fix_missing" });
                      onEdit(event);
                    }}
                    accessibilityRole="button"
                    style={[styles.addDetail, { borderColor: auraSignal.amber }]}
                  >
                    <Icon name="plus" size={12} color={auraSignal.amber} />
                    <Text style={[styles.addDetailText, { color: auraSignal.amber, fontFamily: f.semibold }]}>
                      {t(mode === "flight" ? "itinerary.travel.addGateSeat" : "itinerary.travel.addPlatformSeat")}
                    </Text>
                  </PressableScale>
                ) : null}
              </View>
            ) : null}

            {plan.leaveAt > now.getTime() ? (
              <View style={[styles.leave, { borderTopColor: c.hairline }]}>
                <Icon name="clock" size={14} color={c.textSoft} />
                <Text style={[styles.leaveText, { color: c.textSoft, fontFamily: f.medium }]}>
                  {t("itinerary.travel.leaveBy", { time: format.time.format(new Date(plan.leaveAt)) })}
                  {plan.move ? ` · ${t("itinerary.travel.ride", { duration: formatApproxDuration(plan.move.minutes / 60) })}` : ""}
                  {` · ${t(mode === "flight" ? "itinerary.travel.beThereFlight" : "itinerary.travel.beThere", { duration: formatApproxDuration(plan.beThereMinutes / 60) })}`}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, marginBottom: 12 },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingTop: 14 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16 },
  sub: { fontSize: 12.5, marginTop: 1 },
  ticket: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16 },
  ticketText: { fontSize: 12.5 },
  times: { flexDirection: "row", gap: 10, paddingHorizontal: 14, paddingTop: 14 },
  caption: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  time: { fontSize: 20, marginTop: 2, fontVariant: ["tabular-nums"] },
  plus: { fontSize: 12 },
  details: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  detail: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, minWidth: 56 },
  detailLabel: { fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase" },
  detailValue: { fontSize: 15, marginTop: 1 },
  addDetail: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, height: 34, alignSelf: "center", borderRadius: 10, borderWidth: 1, borderStyle: "dashed" },
  addDetailText: { fontSize: 12.5 },
  leave: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth },
  leaveText: { flex: 1, fontSize: 13 },
  flex: { flex: 1 },
});
