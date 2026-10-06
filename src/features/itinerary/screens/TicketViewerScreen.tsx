import React, { useEffect, useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import * as Brightness from "expo-brightness";
import { useLocalSearchParams, useRouter } from "expo-router";
import Pdf from "react-native-pdf";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, PressableScale, showAlert } from "@/atoms";
import { auraFonts as f } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { logger } from "@/modules/logger";
import { removeTickets } from "@/features/itinerary/services/tickets";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useTicketsStore, type Ticket } from "@/features/itinerary/store/ticketsStore";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";

// Light page and dark text: gate scanners read QR codes best on white at full brightness.
const PAGE = "#FFFFFF";
const INK = "#0E1018";
const MAX_ZOOM = 5;

/** Pinch to zoom, drag to move once zoomed, double tap to reset. */
function ZoomableImage({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const pinch = Gesture.Pinch()
    .onStart(() => startScale.set(scale.get()))
    .onUpdate((event) => scale.set(Math.min(MAX_ZOOM, Math.max(1, startScale.get() * event.scale))));
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onChange((event) => {
      if (scale.get() <= 1) return;
      x.set(x.get() + event.changeX);
      y.set(y.get() + event.changeY);
    });
  const reset = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.set(withTiming(1));
      x.set(withTiming(0));
      y.set(withTiming(0));
    });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, reset)}>
      <Animated.View style={[styles.fill, style]}>
        <Image source={{ uri }} style={styles.fill} resizeMode="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

/** A trip item's tickets full screen at full brightness, for showing at gates and counters. */
export default function TicketViewerScreen() {
  const { eventId, ticketId } = useLocalSearchParams<{ eventId: string; ticketId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLocalization();
  const allTickets = useTicketsStore((state) => state.tickets);
  const event = useEventsStore((state) => state.events.find((item) => item.id === eventId));
  const tickets = allTickets.filter((ticket) => ticket.eventId === eventId);
  const [index, setIndex] = useState(() => Math.max(0, tickets.findIndex((ticket) => ticket.id === ticketId)));
  const [failed, setFailed] = useState<string | null>(null);
  const ticket: Ticket | undefined = tickets[Math.min(index, tickets.length - 1)];

  useEffect(() => {
    let previous: number | null = null;
    void (async () => {
      try {
        previous = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1);
      } catch (err) {
        logger.warn("tickets", "brightness unavailable", err);
      }
    })();
    return () => {
      // Android hands brightness back to the system setting; iOS needs the old level put back.
      if (Platform.OS === "android") void Brightness.restoreSystemBrightnessAsync().catch(() => {});
      else if (previous !== null) void Brightness.setBrightnessAsync(previous).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (ticket) track("ticket_opened", { kind: ticket.kind, count: tickets.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id]);

  useEffect(() => {
    if (!ticket) router.back();
  }, [router, ticket]);

  if (!ticket) return null;

  const confirmRemove = () =>
    showAlert(t("tickets.removeTitle"), t("tickets.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("tickets.remove"),
        style: "destructive",
        onPress: () => {
          setIndex((current) => Math.max(0, current - 1));
          void removeTickets([ticket]);
        },
      },
    ]);

  return (
    <View style={[styles.root, { backgroundColor: PAGE }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.round}>
          <Icon name="x" size={18} color={INK} />
        </PressableScale>
        <View style={styles.titles}>
          <Text numberOfLines={1} style={styles.title}>
            {event ? localizeEventTitle(event.title, t) : ticket.name}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {tickets.length > 1 ? `${ticket.name} · ${t("tickets.position", { index: index + 1, total: tickets.length })}` : ticket.name}
          </Text>
        </View>
        <PressableScale onPress={confirmRemove} accessibilityRole="button" accessibilityLabel={t("tickets.remove")} style={styles.round}>
          <Icon name="trash" size={17} color={INK} />
        </PressableScale>
      </View>

      <PrivateView style={styles.fill}>
        {failed === ticket.id ? (
          <View style={styles.center}>
            <Text style={styles.subtitle}>{t("tickets.openFailed")}</Text>
          </View>
        ) : ticket.kind === "pdf" ? (
          <Pdf
            key={ticket.id}
            source={{ uri: ticket.uri }}
            style={[styles.fill, { backgroundColor: PAGE }]}
            maxScale={MAX_ZOOM}
            onError={(err) => {
              logger.warn("tickets", "pdf failed to open", err);
              setFailed(ticket.id);
            }}
          />
        ) : (
          <ZoomableImage key={ticket.id} uri={ticket.uri} />
        )}
      </PrivateView>

      {tickets.length > 1 ? (
        <View style={[styles.pager, { paddingBottom: insets.bottom + 12 }]}>
          <PressableScale
            disabled={index === 0}
            onPress={() => setIndex(index - 1)}
            accessibilityRole="button"
            accessibilityLabel={t("tickets.previous")}
            style={[styles.round, { opacity: index === 0 ? 0.3 : 1 }]}
          >
            <Icon name="chevronLeft" size={18} color={INK} />
          </PressableScale>
          <Text style={styles.subtitle}>{t("tickets.position", { index: index + 1, total: tickets.length })}</Text>
          <PressableScale
            disabled={index === tickets.length - 1}
            onPress={() => setIndex(index + 1)}
            accessibilityRole="button"
            accessibilityLabel={t("tickets.next")}
            style={[styles.round, { opacity: index === tickets.length - 1 ? 0.3 : 1 }]}
          >
            <Icon name="chevronRight" size={18} color={INK} />
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(14,16,24,0.06)" },
  titles: { flex: 1 },
  title: { fontFamily: f.semibold, fontSize: 16, color: INK },
  subtitle: { fontFamily: f.regular, fontSize: 13, color: "rgba(14,16,24,0.6)" },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, paddingTop: 10 },
});
