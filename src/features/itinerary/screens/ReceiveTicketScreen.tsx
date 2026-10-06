import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuraListGroup, AuraListRow, Icon, PressableScale, showToast, useAura } from "@/atoms";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { SELF_ID } from "@/features/expenses/utils/split";
import { getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import { saveReceivedTicket } from "@/features/itinerary/services/tickets";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { useIncomingTicketStore } from "@/features/itinerary/store/incomingTicketStore";
import { useTicketsStore, type Ticket } from "@/features/itinerary/store/ticketsStore";
import { formatters } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { selectActiveTrip, useTripsStore } from "@/features/trips/store/tripsStore";

// "%PDF" in base64: content:// links carry no file extension, so the first bytes decide.
const PDF_MAGIC = "JVBERi";

/** Picks the item a ticket someone sent belongs to: items someone else holds a ticket for come first. */
export default function ReceiveTicketScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const uri = useIncomingTicketStore((state) => state.uri);
  const clear = useIncomingTicketStore((state) => state.set);
  const trip = useTripsStore(selectActiveTrip);
  const events = useEventsStore((state) => state.events);
  const tickets = useTicketsStore((state) => state.tickets);
  const [kind, setKind] = useState<Ticket["kind"] | null>(null);
  const format = formatters(locale, hour12);

  useEffect(() => {
    if (!uri) return;
    const store = useIncomingTicketStore.getState();
    if (store.wasHandled(uri)) {
      store.set(null);
      router.replace("/");
      return;
    }
    store.markHandled(uri);
  }, [router, uri]);

  useEffect(() => {
    if (!uri) return;
    FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 6 })
      .then((head) => setKind(head.startsWith(PDF_MAGIC) ? "pdf" : "image"))
      .catch(() => setKind("pdf"));
  }, [uri]);

  const held = new Set(tickets.map((ticket) => ticket.eventId));
  const waiting = (event: TripEvent) => !held.has(event.id) && (event.ticketHolders ?? []).some((person) => person !== SELF_ID);
  const items = trip
    ? events
        .filter((event) => event.tripId === trip.id && event.timing !== "wishlist")
        .sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    : [];

  const close = () => {
    clear(null);
    router.back();
  };

  const pick = async (event: TripEvent) => {
    if (!uri || !kind) return;
    const ticket = await saveReceivedTicket(event.id, uri, kind);
    clear(null);
    if (!ticket) {
      showToast(t("tickets.receiveFailed"));
      router.back();
      return;
    }
    track("ticket_added", { source: "received", count: 1 });
    router.replace({ pathname: "/ticket/[eventId]", params: { eventId: event.id, ticketId: ticket.id } });
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("tickets.receiveTitle")}</Text>
          <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>{trip ? trip.name : t("tickets.receiveNoTrip")}</Text>
        </View>
        <PressableScale onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} style={[styles.round, { backgroundColor: c.surfaceStrong }]}>
          <Icon name="x" size={16} color={c.text} />
        </PressableScale>
      </View>
      <PrivateView style={styles.flex}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}>
          {!uri ? (
            <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>{t("tickets.receiveNothing")}</Text>
          ) : items.length === 0 ? (
            <Text style={[styles.sub, { color: c.textMuted, fontFamily: f.regular }]}>{t("tickets.receiveNoItems")}</Text>
          ) : (
            <AuraListGroup footer={t("tickets.onlyHere")}>
              {items.map((event) => (
                <AuraListRow
                  key={event.id}
                  icon={getEventTypeMeta(event.type).icon}
                  tone={auraEventColors[event.type]}
                  label={localizeEventTitle(event.title, t)}
                  detail={
                    waiting(event)
                      ? t("tickets.heldBy", { names: (event.ticketHolders ?? []).filter((person) => person !== SELF_ID).join(", ") })
                      : `${format.dayHeader.format(new Date(event.startAt))}${event.timing ? "" : `, ${format.time.format(new Date(event.startAt))}`}`
                  }
                  disabled={!kind}
                  onPress={() => void pick(event)}
                />
              ))}
            </AuraListGroup>
          )}
        </ScrollView>
      </PrivateView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20 },
  title: { fontSize: 22, letterSpacing: -0.4 },
  sub: { fontSize: 14, marginTop: 2 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
