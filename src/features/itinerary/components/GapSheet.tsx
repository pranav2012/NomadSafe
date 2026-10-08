import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraSheet, Icon, showToast, useAura } from "@/atoms";
import { auraSpace } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { NearbyPlaces } from "@/features/places/components/NearbyPlaces";
import type { Trip } from "@/features/trips/store/tripsStore";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import type { FreeGap } from "@/features/itinerary/components/DayPlan";
import { estimateMove } from "@/features/itinerary/utils/dayShape";
import { formatters } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { ideasOf } from "@/features/itinerary/utils/ideas";
import { toWallClock } from "@/features/itinerary/utils/wallClock";

const IDEA_MAX_MINUTES = 40;
const FIVE_MIN = 5 * 60_000;

/** What to do with a free window or an open meal: saved ideas close by, then places nearby open at that time; either can be added there. */
export function GapSheet({ trip, events, gap, onClose }: { trip: Trip; events: TripEvent[]; gap: FreeGap | null; onClose: () => void }) {
  const { c, f } = useAura();
  const { t, locale, hour12, formatApproxDuration } = useLocalization();
  const addEvent = useEventsStore((state) => state.addEvent);
  const updateEvent = useEventsStore((state) => state.updateEvent);
  const format = formatters(locale, hour12);
  if (!gap) return null;

  const startAt = toWallClock(new Date(Math.ceil(gap.from / FIVE_MIN) * FIVE_MIN));
  const range = `${format.time.format(new Date(gap.from))}–${format.time.format(new Date(gap.to))}`;
  const near = gap.near;
  const ideas = near
    ? ideasOf(events)
        .flatMap((idea) => {
          const move = estimateMove(near, idea.place ?? null);
          return idea.place && (!move || move.minutes <= IDEA_MAX_MINUTES) ? [{ idea, move }] : [];
        })
        .slice(0, 5)
    : [];

  const planIdea = (idea: TripEvent) => {
    updateEvent(idea.id, { timing: undefined, startAt });
    track("saved_idea_action", { action: "planned", where: "day_ideas" });
    showToast(t("itinerary.gap.added", { title: localizeEventTitle(idea.title, t) }));
    onClose();
  };

  return (
    <AuraSheet visible onClose={onClose} title={gap.meal ? t(`itinerary.gap.${gap.meal}Title`) : t("itinerary.gap.freeTitle")} subtitle={range}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {ideas.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.heading, { color: c.textSoft, fontFamily: f.medium }]}>{t("itinerary.gap.yourIdeas")}</Text>
            {ideas.map(({ idea, move }) => (
              <View key={idea.id} style={[styles.idea, { backgroundColor: c.surface, borderColor: c.hairline }]}>
                <Icon name="bookmark" size={15} color={c.textSoft} />
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={[styles.ideaTitle, { color: c.text, fontFamily: f.semibold }]}>
                    {localizeEventTitle(idea.title, t)}
                  </Text>
                  {move ? (
                    <Text style={[styles.ideaSub, { color: c.textMuted, fontFamily: f.regular }]}>
                      {t(`itinerary.gap.${move.mode}Short`, { duration: formatApproxDuration(move.minutes / 60) })}
                    </Text>
                  ) : null}
                </View>
                <AuraButton size="md" variant="secondary" icon="plus" label={t("places.add")} onPress={() => planIdea(idea)} />
              </View>
            ))}
          </View>
        ) : null}
        {near ? (
          <NearbyPlaces
            userLocation={near}
            title={t("itinerary.gap.nearby")}
            initialCategory={gap.meal ? "food" : "sights"}
            at={gap.from}
            onAdd={(place, category) => {
              addEvent({
                tripId: trip.id,
                type: category === "food" || category === "coffee" ? "food" : "activity",
                title: place.name,
                startAt,
                place: { name: place.name, latitude: place.latitude, longitude: place.longitude },
                source: "manual",
              });
              track("itinerary_event_added", { source: "manual", count: 1 });
              showToast(t("itinerary.gap.added", { title: place.name }));
              onClose();
            }}
          />
        ) : (
          <Text style={[styles.empty, { color: c.textMuted, fontFamily: f.regular }]}>{t("itinerary.gap.noPlace")}</Text>
        )}
      </ScrollView>
    </AuraSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: auraSpace.screen, paddingBottom: 24, gap: 18 },
  section: { gap: 8 },
  heading: { fontSize: 13.5 },
  idea: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  ideaTitle: { fontSize: 15 },
  ideaSub: { fontSize: 12.5, marginTop: 2 },
  empty: { fontSize: 14, lineHeight: 20 },
  flex: { flex: 1 },
});
