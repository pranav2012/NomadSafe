import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraSection } from "@/components/aura/AuraSection";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { useAura } from "@/components/aura/useAura";
import { auraEventColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { localModelService, useAiReadyModelId } from "@/features/ai";
import { useSettingsStore } from "@/features/settings";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import { EventForm, type EventFormValues } from "@/features/itinerary/components/EventForm";
import { EventDeck, type DeckEvent } from "@/features/itinerary/components/EventDeck";
import { localizeEventDetail, localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { logger } from "@/services/logger";

const DECK_COUNT = 5;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Returns the next upcoming events first, falling back to the most recent ones. */
function pickPreview(ordered: TripEvent[]): TripEvent[] {
  const today = startOfDay(new Date());
  const upcoming = ordered.filter((event) => startOfDay(new Date(event.startAt)) >= today);
  return upcoming.length > 0 ? upcoming.slice(0, DECK_COUNT) : ordered.slice(-DECK_COUNT);
}

/** Keeps an edited event's duration by moving `endAt` along with `startAt`. */
function shiftEndAt(event: TripEvent, startAt: string): string | undefined {
  if (!event.endAt) return undefined;
  const delta = new Date(startAt).getTime() - new Date(event.startAt).getTime();
  const end = new Date(new Date(event.endAt).getTime() + delta);
  return Number.isNaN(end.getTime()) ? event.endAt : end.toISOString();
}

/**
 * The trip's itinerary on Home: a swipeable deck of what's next (tap to edit), an "All events"
 * sheet, adding events, and on-device AI refinement with a review sheet before anything is removed.
 */
export function TripItinerary({ trip, accent }: { trip: Trip; accent: string }) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const events = useEventsStore((state) => state.events);
  const addEvent = useEventsStore((state) => state.addEvent);
  const updateEvent = useEventsStore((state) => state.updateEvent);
  const deleteEvent = useEventsStore((state) => state.deleteEvent);
  const deleteEvents = useEventsStore((state) => state.deleteEvents);
  const localAiEnabled = useSettingsStore((state) => state.localAiEnabled);
  const aiReadyModelId = useAiReadyModelId();

  const [isAiAvailable, setIsAiAvailable] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [review, setReview] = useState<{ keep: number; remove: string[] } | null>(null);
  // `null` = closed; "new" = add form; otherwise the event being edited.
  const [editing, setEditing] = useState<TripEvent | "new" | null>(null);

  const ordered = useMemo(
    () => events.filter((event) => event.tripId === trip.id).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [events, trip.id],
  );
  const timeFormatter = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const toDeck = (event: TripEvent): DeckEvent => ({
    id: event.id,
    type: event.type,
    title: localizeEventTitle(event.title, t),
    detail: localizeEventDetail(event.detail, t),
    time: timeFormatter.format(new Date(event.startAt)),
  });
  const deck = pickPreview(ordered).map(toDeck);

  useEffect(() => {
    let mounted = true;
    localModelService
      .getReadyModel()
      .then((model) => {
        if (mounted) setIsAiAvailable(model !== null);
      })
      .catch(() => {
        if (mounted) setIsAiAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, [aiReadyModelId, localAiEnabled]);

  const openEvent = (id: string) => {
    const event = ordered.find((e) => e.id === id);
    if (event) setEditing(event);
  };

  const handleSave = (values: EventFormValues) => {
    if (editing && editing !== "new") {
      updateEvent(editing.id, {
        type: values.type,
        title: values.title,
        detail: values.detail || undefined,
        startAt: values.startAt,
        endAt: shiftEndAt(editing, values.startAt),
      });
    } else {
      addEvent({ tripId: trip.id, type: values.type, title: values.title, detail: values.detail || undefined, startAt: values.startAt, source: "manual" });
    }
    setEditing(null);
  };

  const handleRefine = useCallback(async () => {
    if (isRefining || ordered.length === 0) return;
    setIsRefining(true);
    try {
      const refinement = await localModelService.refineItinerary(ordered);
      const remove = ordered.filter((event) => !refinement.keepIds.includes(event.id)).map((event) => event.id);
      if (remove.length === 0) {
        Alert.alert(t("itinerary.refineNoneTitle"), t("itinerary.refineNoneBody"));
        return;
      }
      setReview({ keep: refinement.keepIds.length, remove });
    } catch (error) {
      logger.warn("itinerary-refinement", "failed", error);
      Alert.alert(t("itinerary.refineErrorTitle"), t("itinerary.refineErrorBody"));
    } finally {
      await localModelService.release();
      setIsRefining(false);
    }
  }, [isRefining, ordered, t]);

  return (
    <View>
      <AuraSection
        title={t("itinerary.title")}
        action={
          <>
            {isAiAvailable && ordered.length > 1 ? (
              <AuraButton
                label={isRefining ? t("itinerary.refining") : t("home.refine")}
                icon="sparkle"
                variant="secondary"
                size="md"
                loading={isRefining}
                onPress={() => void handleRefine()}
              />
            ) : null}
            <AuraButton label={t("itinerary.add")} icon="plus" variant="secondary" size="md" onPress={() => setEditing("new")} />
          </>
        }
      />

      {deck.length > 0 ? (
        <Animated.View entering={FadeIn.duration(300)}>
          <EventDeck events={deck} palette={c} accent={accent} onPressEvent={openEvent} />
          {ordered.length > deck.length || ordered.length > 1 ? (
            <AuraButton
              label={t("itinerary.viewAll", { count: ordered.length })}
              variant="ghost"
              size="md"
              onPress={() => setAllOpen(true)}
              style={styles.viewAll}
            />
          ) : null}
        </Animated.View>
      ) : (
        <PressableScale
          onPress={() => setEditing("new")}
          pressedScale={0.98}
          style={[styles.empty, { backgroundColor: c.surface, borderColor: c.hairline }]}
        >
          <View style={[styles.emptyIcon, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="calendar" size={18} color={c.textSoft} />
          </View>
          <Text style={[styles.emptyText, { color: c.textSoft, fontFamily: f.regular }]}>{t("itinerary.empty")}</Text>
        </PressableScale>
      )}

      <AuraSheet visible={allOpen} onClose={() => setAllOpen(false)} title={t("itinerary.title")} subtitle={trip.name}>
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {ordered.map((event) => (
            <EventRow
              key={event.id}
              event={toDeck(event)}
              past={startOfDay(new Date(event.startAt)) < startOfDay(new Date())}
              onPress={() => {
                setAllOpen(false);
                setEditing(event);
              }}
            />
          ))}
        </ScrollView>
      </AuraSheet>

      <AuraSheet
        visible={review !== null}
        onClose={() => setReview(null)}
        title={t("itinerary.refineReviewTitle")}
        footer={
          <View style={styles.reviewActions}>
            <AuraButton label={t("common.cancel")} variant="secondary" onPress={() => setReview(null)} style={styles.flex} />
            <AuraButton
              label={t("itinerary.refineApply")}
              variant="danger"
              onPress={() => {
                if (review) deleteEvents(review.remove);
                setReview(null);
              }}
              style={styles.flex}
            />
          </View>
        }
      >
        <Text style={[styles.reviewBody, { color: c.textSoft, fontFamily: f.regular }]}>
          {review ? t("itinerary.refineReviewBody", { keep: review.keep, remove: review.remove.length }) : ""}
        </Text>
      </AuraSheet>

      {editing !== null ? (
        <EventForm
          key={editing === "new" ? "new" : editing.id}
          event={editing === "new" ? null : editing}
          visible
          onSave={handleSave}
          onDelete={
            editing !== "new"
              ? () => {
                  deleteEvent(editing.id);
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

function EventRow({ event, past, onPress }: { event: DeckEvent; past: boolean; onPress: () => void }) {
  const { c, f } = useAura();
  const meta = getEventTypeMeta(event.type);
  const color = auraEventColors[event.type];
  return (
    <PressableScale onPress={onPress} pressedScale={0.98} style={[styles.row, { opacity: past ? 0.55 : 1 }]}>
      <View style={[styles.rowIcon, { backgroundColor: `${color}22` }]}>
        <Icon name={meta.icon} size={16} color={color} />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: c.text, fontFamily: f.semibold }]}>
          {event.title}
        </Text>
        <Text numberOfLines={1} style={[styles.rowSub, { color: c.textMuted, fontFamily: f.regular }]}>
          {[event.time, event.detail].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <Icon name="chevronRight" size={14} color={c.textMuted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  viewAll: { alignSelf: "center", marginTop: 6 },
  empty: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  emptyIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  emptyText: { flex: 1, fontSize: 14, lineHeight: 20 },
  list: { paddingHorizontal: 20, paddingBottom: 12, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15 },
  rowSub: { fontSize: 13 },
  reviewActions: { flexDirection: "row", gap: 10 },
  reviewBody: { fontSize: 15, lineHeight: 22, paddingHorizontal: 20, paddingBottom: 8 },
  flex: { flex: 1 },
});
