import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { AuraButton, AuraSection, AuraSheet, showAlert, showToast, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { aiRuntime, aiService, useAiAvailability } from "@/modules/ai";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { PlannedList, TimelineList, UpNextList } from "@/features/itinerary/components/ItineraryViews";
import { DayPlan, type FreeGap } from "@/features/itinerary/components/DayPlan";
import { DayIdeas } from "@/features/itinerary/components/DayIdeas";
import { GapSheet } from "@/features/itinerary/components/GapSheet";
import { TravelDayCard } from "@/features/itinerary/components/TravelDayCard";
import { GlanceDayCard, useOpenTripPlan, useTripGlance } from "@/features/itinerary/components/TripGlance";
import { useSaveMustDo } from "@/features/itinerary/hooks/useSaveMustDo";
import { defaultStartFor, useItineraryEditor } from "@/features/itinerary/hooks/useItineraryEditor";
import { useItineraryPlaces } from "@/features/itinerary/hooks/useItineraryPlaces";
import { ideasNear, ideasOf } from "@/features/itinerary/utils/ideas";
import { formatters } from "@/features/itinerary/utils/entryText";
import { toWallClock } from "@/features/itinerary/utils/wallClock";
import { mustDosNear } from "@/features/itinerary/utils/mustDos";
import { useMustDoStore } from "@/features/itinerary/store/mustDoStore";
import { pruneTickets, reconcileTicketHolders } from "@/features/itinerary/services/tickets";
import { upNext } from "@/features/itinerary/utils/timeline";
import { fromDateKey } from "@/features/trips/utils/dates";
import { logger } from "@/modules/logger";
import { showInterstitial } from "@/modules/ads";
import { ItineraryEmpty } from "@/features/itinerary/components/ItineraryEmpty";
import { GmailReviewCard } from "@/features/expenses/components/GmailReviewSheet";

const UP_NEXT_COUNT = 3;
const PLANNED_COUNT = 5;

/**
 * The trip's itinerary on Home: "Trip at a glance" before the trip (`glance`), one day's plan when
 * `day` is set, else the next few bookings; adding and editing items, the full plan screen, and
 * on-device AI refinement with a review sheet before anything is removed.
 */
export function TripItinerary({
  trip,
  day,
  now: liveNow,
  place,
  glance,
  glanceDay = 0,
}: {
  trip: Trip;
  accent: string;
  /** Show this day's plan instead of "Up next". */
  day?: Date | null;
  now?: Date;
  /** Where the day is spent: names Maps searches ("Nishiki Market, Kyoto") and picks must-dos. */
  place?: { name: string; latitude: number; longitude: number };
  /** Before the trip: the day picked on Home's day rail (`glanceDay`) instead of "Up next". */
  glance?: boolean;
  glanceDay?: number;
}) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const updateEvent = useEventsStore((state) => state.updateEvent);
  const deleteEvents = useEventsStore((state) => state.deleteEvents);
  const isAiAvailable = useAiAvailability("itinerary").available;
  const { context, glance: glanceDays } = useTripGlance(trip);
  const editor = useItineraryEditor(trip);
  const openPlan = useOpenTripPlan(trip);
  useItineraryPlaces(trip);

  const [isRefining, setIsRefining] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [gap, setGap] = useState<FreeGap | null>(null);
  const [review, setReview] = useState<{ keep: number; remove: string[] } | null>(null);

  const ordered = context.tripEvents;
  const [mountedAt] = useState(() => Date.now());
  const now = liveNow?.getTime() ?? mountedAt;
  const next = upNext(ordered, now, UP_NEXT_COUNT);
  // Refine only tidies Gmail imports; what the user added is theirs to keep.
  const imported = ordered.filter((event) => event.source === "email");

  // Items removed elsewhere (sync, another member) leave their files behind; tidy up once per mount.
  useEffect(() => {
    void pruneTickets().then(reconcileTicketHolders);
  }, []);

  const dismissed = useMustDoStore((state) => state.dismissed[trip.id]);
  const dismissMustDo = useMustDoStore((state) => state.dismiss);
  const city = place?.name.split(",")[0];
  const mustDos = place ? (mustDosNear(place, locale, [...ordered.map((event) => event.title), ...(dismissed ?? [])])?.items ?? []) : [];

  const saveMustDo = useSaveMustDo();
  const ideas = ideasOf(ordered);
  const dayIdeas = place ? ideasNear(ideas, place) : [];
  const planned = ordered.filter((event) => event.timing === "anytime" && !event.doneAt);
  const openAll = () => {
    setAllOpen(true);
    track("itinerary_sheet_opened", { events: ordered.length });
  };
  const isToday = day ? day.toDateString() === new Date(now).toDateString() : false;
  const sectionTitle = day ? (isToday ? t("home.live.todayTitle") : formatters(locale, hour12).dayHeader.format(day)) : t("itinerary.title");

  const scheduleOn = (event: TripEvent, target: Date) => {
    track("saved_idea_action", { action: "planned", where: "day_ideas" });
    updateEvent(event.id, { timing: "anytime", startAt: toWallClock(new Date(target.getFullYear(), target.getMonth(), target.getDate())) });
  };

  // The refine result is a natural break once the user has dealt with it.
  const closeReview = () => {
    if (!review) return;
    setReview(null);
    showInterstitial("itinerary_refined");
  };

  const handleRefine = useCallback(async () => {
    if (isRefining || imported.length === 0) return;
    setIsRefining(true);
    try {
      const refinement = await aiService.refineItinerary(imported);
      const remove = imported.filter((event) => !refinement.keepIds.includes(event.id)).map((event) => event.id);
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
  }, [isRefining, imported, t]);

  const addFromScreenshot = () => editor.add(defaultStartFor(day, now), { screenshot: true });

  return (
    <PrivateView>
      {glance && ordered.length > 0 ? null : (
        <AuraSection
          title={sectionTitle}
          action={
            <>
              {isAiAvailable && imported.length > 1 ? (
                <AuraButton
                  label={isRefining ? t("itinerary.refining") : t("home.refine")}
                  icon="sparkle"
                  variant="secondary"
                  size="md"
                  loading={isRefining}
                  onPress={() => void handleRefine()}
                />
              ) : null}
              <AuraButton label={t("itinerary.add")} icon="plus" variant="secondary" size="md" onPress={() => editor.add(defaultStartFor(day, now))} />
            </>
          }
        />
      )}

      <GmailReviewCard tripId={trip.id} from="trip" />
      {day && ordered.length > 0 ? (
        <Animated.View entering={FadeIn.duration(300)}>
          <TravelDayCard
            events={ordered}
            day={day}
            now={new Date(now)}
            homeCountry={context.homeCountry}
            ticketEventIds={context.ticketEventIds}
            onOpenTicket={editor.openTickets}
            onEdit={editor.edit}
          />
          <DayPlan
            events={ordered}
            day={day}
            now={new Date(now)}
            city={city}
            meals={context.mealsOn(day)}
            learned={context.learned}
            homeCountry={context.homeCountry}
            placeFailedIds={context.placeFailedIds}
            onPress={editor.edit}
            ticketEventIds={context.ticketEventIds}
            onOpenTickets={editor.openTickets}
            onAskForTicket={editor.askForTicket}
            onToggleDone={editor.toggleDone}
            onGap={setGap}
            onAdd={() => {
              track("today_action", { action: "add_stop" });
              editor.add(defaultStartFor(day, now));
            }}
          />
          <View style={styles.dayActions}>
            <AuraButton label={t("itinerary.plan.dayOnMap")} icon="mapPin" variant="ghost" size="md" onPress={() => openPlan("day", day)} />
            <AuraButton label={t("itinerary.plan.wholeTrip")} icon="calendar" variant="ghost" size="md" onPress={() => openPlan("day")} />
          </View>
        </Animated.View>
      ) : glance && ordered.length > 0 ? (
        <Animated.View entering={FadeIn.duration(300)}>
          <GlanceDayCard
            trip={trip}
            day={glanceDays[glanceDay]}
            index={glanceDay}
            onAdd={() => editor.add(defaultStartFor(glanceDays[glanceDay]?.date, now))}
          />
        </Animated.View>
      ) : next.length > 0 ? (
        <Animated.View entering={FadeIn.duration(300)}>
          <UpNextList events={next} onPress={editor.edit} />
          {ordered.length > 1 && planned.length === 0 ? (
            <AuraButton label={t("itinerary.fullItinerary", { total: ordered.length })} variant="ghost" size="md" onPress={openAll} style={styles.viewAll} />
          ) : null}
        </Animated.View>
      ) : (
        <ItineraryEmpty trip={trip} preview={glance} onAdd={() => editor.add(defaultStartFor(day, now))} onScreenshot={addFromScreenshot} />
      )}

      {!day && !glance && planned.length > 0 ? (
        <Animated.View entering={FadeIn.duration(300)}>
          <AuraSection title={t("itinerary.plannedTitle")} style={styles.planned} />
          <PlannedList events={planned.slice(0, PLANNED_COUNT)} onPress={editor.edit} />
          <AuraButton label={t("itinerary.fullItinerary", { total: ordered.length })} variant="ghost" size="md" onPress={openAll} style={styles.viewAll} />
        </Animated.View>
      ) : null}

      {day ? (
        <DayIdeas
          city={city}
          ideas={dayIdeas}
          mustDos={mustDos}
          onAddToDay={(idea) => scheduleOn(idea, day)}
          onSaveMustDo={(item) => saveMustDo(trip, item, "day_ideas")}
          onDismissMustDo={(item) => {
            track("must_do_suggestion", { action: "dismissed", where: "day_ideas" });
            dismissMustDo(trip.id, item.key);
          }}
        />
      ) : null}

      <AuraSheet visible={allOpen} onClose={() => setAllOpen(false)} title={t("itinerary.title")} subtitle={trip.name} full>
        <PrivateView style={styles.flex}>
          <TimelineList
            events={ordered}
            tripStart={fromDateKey(trip.startDate)}
            onPress={(event) => {
              setAllOpen(false);
              editor.edit(event);
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

      <GapSheet trip={trip} events={ordered} gap={gap} onClose={() => setGap(null)} />
      {editor.form}
    </PrivateView>
  );
}

const styles = StyleSheet.create({
  planned: { marginTop: 24, marginBottom: 12 },
  viewAll: { alignSelf: "center", marginTop: 6 },
  dayActions: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 4, marginTop: 6 },
  reviewActions: { flexDirection: "row", gap: 10 },
  reviewBody: { fontSize: 15, lineHeight: 22, paddingHorizontal: 20, paddingBottom: 8 },
  flex: { flex: 1 },
});
