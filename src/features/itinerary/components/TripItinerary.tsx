import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { AuraButton, AuraSection, AuraSheet, Icon, PressableScale, showAlert, showToast, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { aiRuntime, aiService, useAiAvailability } from "@/modules/ai";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { EventForm, type EventFormValues } from "@/features/itinerary/components/EventForm";
import { TimelineList, UpNextList } from "@/features/itinerary/components/ItineraryViews";
import { DayPlan } from "@/features/itinerary/components/DayPlan";
import { formatters } from "@/features/itinerary/utils/entryText";
import { upNext } from "@/features/itinerary/utils/timeline";
import { fromDateKey } from "@/features/trips/utils/dates";
import { logger } from "@/modules/logger";
import { showInterstitial } from "@/modules/ads";
import { useGmailImport } from "@/features/expenses/hooks/useGmailImport";
import { useGmailProgressLabel, useGmailStatus } from "@/features/expenses/hooks/useGmailStatus";
import { syncTripGmail } from "@/features/expenses/services/tripGmailSync";
import { useTripGmailSyncStatus } from "@/features/expenses/store/gmailSyncStatusStore";

const UP_NEXT_COUNT = 3;

/** Where a new event starts: the next full hour on today, 09:00 on another day, now without a day. */
function defaultStartFor(day: Date | null | undefined, now: number): Date | undefined {
  if (!day) return undefined;
  const current = new Date(now);
  if (day.toDateString() === current.toDateString()) {
    return new Date(current.getFullYear(), current.getMonth(), current.getDate(), current.getHours() + 1);
  }
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9);
}

/**
 * The trip's itinerary on Home: the next few bookings (tap to edit), or one day's plan when `day`
 * is set, a day-by-day "Full itinerary" sheet, adding events, and on-device AI refinement with a
 * review sheet before anything is removed.
 */
export function TripItinerary({
  trip,
  day,
  now: liveNow,
  city,
}: {
  trip: Trip;
  accent: string;
  /** Show this day's plan instead of "Up next". */
  day?: Date | null;
  now?: Date;
  /** Added to Maps searches, e.g. "Nishiki Market, Kyoto". */
  city?: string;
}) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const events = useEventsStore((state) => state.events);
  const addEvent = useEventsStore((state) => state.addEvent);
  const updateEvent = useEventsStore((state) => state.updateEvent);
  const deleteEvent = useEventsStore((state) => state.deleteEvent);
  const deleteEvents = useEventsStore((state) => state.deleteEvents);
  const isAiAvailable = useAiAvailability("itinerary").available;

  const [isRefining, setIsRefining] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [review, setReview] = useState<{ keep: number; remove: string[] } | null>(null);
  // `null` = closed; "new" = add form; otherwise the event being edited.
  const [editing, setEditing] = useState<TripEvent | "new" | null>(null);

  const ordered = useMemo(
    () => events.filter((event) => event.tripId === trip.id).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [events, trip.id],
  );
  const [mountedAt] = useState(() => Date.now());
  const now = liveNow?.getTime() ?? mountedAt;
  const next = upNext(ordered, now, UP_NEXT_COUNT);
  const isToday = day ? day.toDateString() === new Date(now).toDateString() : false;
  const sectionTitle = day ? (isToday ? t("home.live.todayTitle") : formatters(locale, hour12).dayHeader.format(day)) : t("itinerary.title");

  const handleSave = (values: EventFormValues) => {
    if (editing && editing !== "new") {
      updateEvent(editing.id, {
        type: values.type,
        title: values.title,
        detail: values.detail || undefined,
        transitMode: values.transitMode,
        startAt: values.startAt,
        endAt: values.endAt,
        editedAt: new Date().toISOString(),
      });
      track("itinerary_event_edited", { source: editing.source });
    } else {
      addEvent({
        tripId: trip.id,
        type: values.type,
        title: values.title,
        detail: values.detail || undefined,
        transitMode: values.transitMode,
        startAt: values.startAt,
        endAt: values.endAt,
        source: "manual",
      });
      track("itinerary_event_added", { source: "manual", count: 1 });
    }
    setEditing(null);
    if (editing === "new") showInterstitial("itinerary_event_added");
  };

  // The refine result is a natural break once the user has dealt with it.
  const closeReview = () => {
    if (!review) return;
    setReview(null);
    showInterstitial("itinerary_refined");
  };

  const handleRefine = useCallback(async () => {
    if (isRefining || ordered.length === 0) return;
    setIsRefining(true);
    try {
      const refinement = await aiService.refineItinerary(ordered);
      const remove = ordered.filter((event) => !refinement.keepIds.includes(event.id)).map((event) => event.id);
      if (remove.length === 0) {
        showToast(t("itinerary.refineNoneTitle"), t("itinerary.refineNoneBody"));
        return;
      }
      setReview({ keep: refinement.keepIds.length, remove });
    } catch (error) {
      logger.warn("itinerary-refinement", "failed", error);
      showAlert(t("itinerary.refineErrorTitle"), t("itinerary.refineErrorBody"));
    } finally {
      await aiRuntime.release();
      setIsRefining(false);
    }
  }, [isRefining, ordered, t]);

  return (
    <PrivateView>
      <AuraSection
        title={sectionTitle}
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

      {day && ordered.length > 0 ? (
        <Animated.View entering={FadeIn.duration(300)}>
          <DayPlan
            events={ordered}
            day={day}
            now={new Date(now)}
            city={city}
            onPress={setEditing}
            onAdd={() => {
              track("today_action", { action: "add_stop" });
              setEditing("new");
            }}
          />
          {ordered.length > 0 ? (
            <AuraButton
              label={t("itinerary.fullItinerary", { total: ordered.length })}
              variant="ghost"
              size="md"
              onPress={() => {
                setAllOpen(true);
                track("itinerary_sheet_opened", { events: ordered.length });
              }}
              style={styles.viewAll}
            />
          ) : null}
        </Animated.View>
      ) : next.length > 0 ? (
        <Animated.View entering={FadeIn.duration(300)}>
          <UpNextList events={next} onPress={setEditing} />
          {ordered.length > 1 ? (
            <AuraButton
              label={t("itinerary.fullItinerary", { total: ordered.length })}
              variant="ghost"
              size="md"
              onPress={() => {
                setAllOpen(true);
                track("itinerary_sheet_opened", { events: ordered.length });
              }}
              style={styles.viewAll}
            />
          ) : null}
        </Animated.View>
      ) : (
        <ItineraryEmpty trip={trip} onAdd={() => setEditing("new")} />
      )}

      <AuraSheet visible={allOpen} onClose={() => setAllOpen(false)} title={t("itinerary.title")} subtitle={trip.name} full>
        <PrivateView style={styles.flex}>
          <TimelineList
            events={ordered}
            tripStart={fromDateKey(trip.startDate)}
            onPress={(event) => {
              setAllOpen(false);
              setEditing(event);
            }}
          />
        </PrivateView>
      </AuraSheet>

      <AuraSheet
        visible={review !== null}
        onClose={closeReview}
        title={t("itinerary.refineReviewTitle")}
        footer={
          <View style={styles.reviewActions}>
            <AuraButton label={t("common.cancel")} variant="secondary" onPress={closeReview} style={styles.flex} />
            <AuraButton
              label={t("itinerary.refineApply")}
              variant="danger"
              onPress={() => {
                if (review) deleteEvents(review.remove);
                closeReview();
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
          defaultStart={editing === "new" ? defaultStartFor(day, now) : undefined}
          visible
          onSave={handleSave}
          onDelete={
            editing !== "new"
              ? () => {
                  deleteEvent(editing.id);
                  track("itinerary_event_deleted", { source: editing.source });
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
    </PrivateView>
  );
}

/** Empty state that follows the Gmail booking sync: connect, checking, nothing found or failed. */
function ItineraryEmpty({ trip, onAdd }: { trip: Trip; onAdd: () => void }) {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const gmail = useGmailStatus();
  const { connect, ready } = useGmailImport();
  const progressLabel = useGmailProgressLabel(trip.id);
  const sync = useTripGmailSyncStatus(trip.id).state;

  const syncing = gmail.connected && sync === "syncing";
  const title = gmail.connected && sync === "done" ? t("itinerary.noneFoundTitle") : t("itinerary.emptyTitle");
  const body = !gmail.configured
    ? t("itinerary.emptyManual")
    : !gmail.connected
      ? t("itinerary.emptyConnect")
      : syncing
        ? (progressLabel ?? t("itinerary.syncing"))
        : sync === "failed"
          ? t("itinerary.syncFailed")
          : t("itinerary.noneFoundBody");

  return (
    <PressableScale
      onPress={onAdd}
      pressedScale={0.98}
      accessibilityRole="button"
      accessibilityHint={t("itinerary.form.addTitle")}
      style={[styles.empty, { backgroundColor: c.surface, borderColor: c.hairline }]}
    >
      <View style={styles.emptyHead}>
        <View style={[styles.emptyIcon, { backgroundColor: c.surfaceStrong }]}>
          {syncing ? <ActivityIndicator size="small" color={c.textSoft} /> : <Icon name="calendar" size={18} color={c.textSoft} />}
        </View>
        <View style={styles.flex}>
          <Text style={[styles.emptyTitle, { color: c.text, fontFamily: f.semibold }]}>{title}</Text>
          <Text style={[styles.emptyText, { color: c.textSoft, fontFamily: f.regular }]} accessibilityLiveRegion="polite">
            {body}
          </Text>
        </View>
      </View>
      {gmail.configured && !syncing ? (
        <AuraButton
          size="md"
          variant={gmail.connected ? "secondary" : "primary"}
          icon="mail"
          label={gmail.connected ? t("itinerary.scanAgain") : t("expenses.gmailConnect")}
          disabled={!gmail.connected && !ready}
          onPress={() => void (gmail.connected ? syncTripGmail(trip).catch(() => undefined) : connect())}
        />
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  viewAll: { alignSelf: "center", marginTop: 6 },
  empty: { gap: 14, padding: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  emptyHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  emptyIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 15.5 },
  emptyText: { fontSize: 13.5, lineHeight: 19, marginTop: 2, fontVariant: ["tabular-nums"] },
  reviewActions: { flexDirection: "row", gap: 10 },
  reviewBody: { fontSize: 15, lineHeight: 22, paddingHorizontal: 20, paddingBottom: 8 },
  flex: { flex: 1 },
});
