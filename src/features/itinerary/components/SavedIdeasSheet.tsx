import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { AuraButton, AuraChip, AuraEmptyState, AuraSheet, Icon, PressableScale, useAura } from "@/atoms";
import { auraEventColors, auraHitSlop, auraSignal } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { SELF_ID } from "@/features/expenses/utils/split";
import { getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import { MustDoRow } from "@/features/itinerary/components/MustDoRow";
import { useSaveMustDo } from "@/features/itinerary/hooks/useSaveMustDo";
import { useOpenIdea } from "@/features/itinerary/hooks/useOpenIdea";
import { pruneIdeaThumbs } from "@/features/itinerary/services/ideaThumbs";
import { useIdeaThumbsStore } from "@/features/itinerary/store/ideaThumbsStore";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { useMustDoStore } from "@/features/itinerary/store/mustDoStore";
import { useSavedSheetStore } from "@/features/itinerary/store/savedSheetStore";
import { formatters } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { ideasOf, stopIndexOf } from "@/features/itinerary/utils/ideas";
import { mustDosAlong } from "@/features/itinerary/utils/mustDos";
import { toWallClock } from "@/features/itinerary/utils/wallClock";
import { getDestinationCoordinates, useTripsStore, type PlannedTrip, type Trip } from "@/features/trips/store/tripsStore";
import { addDays, fromDateKey } from "@/features/trips/utils/dates";

interface Stop {
  name: string;
  latitude: number;
  longitude: number;
}

const PROVIDER_NAME = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" } as const;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type PlaceFilter = "all" | number | "none";

/** A trip's or planned trip's places that have coordinates. */
function stopsOf(trip: Trip | PlannedTrip): Stop[] {
  const coordinates = "startDate" in trip ? getDestinationCoordinates(trip) : (trip.destinationCoordinates ?? []);
  return trip.destinations.flatMap((name, index) => {
    const point = coordinates[index];
    return point ? [{ name, ...point }] : [];
  });
}

/**
 * The Saved sheet for a trip or planned trip, mounted once at the root: ideas as dashed cards
 * (filter by stop, plan one for a day once the trip has dates, or remove it) and Popular must-dos.
 */
export function SavedIdeasSheet() {
  const { t } = useLocalization();
  const open = useSavedSheetStore((state) => state.open);
  const close = useSavedSheetStore((state) => state.close);
  const trip = useTripsStore((state) =>
    open ? (state.trips.find((item) => item.id === open.tripId) ?? state.plannedTrips.find((item) => item.id === open.tripId)) : undefined,
  );
  if (!open || !trip) return null;
  return (
    <AuraSheet visible onClose={close} title={t("ideas.sheetTitle")} subtitle={trip.name} full>
      <PrivateView style={styles.flex}>
        <SheetBody key={trip.id} trip={trip} stops={stopsOf(trip)} />
      </PrivateView>
    </AuraSheet>
  );
}

function SheetBody({ trip, stops }: { trip: Trip | PlannedTrip; stops: Stop[] }) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const tab = useSavedSheetStore((state) => state.open?.tab ?? "ideas");
  const setTab = useSavedSheetStore((state) => state.setTab);
  const setConfirmOnClose = useSavedSheetStore((state) => state.setConfirmOnClose);
  const events = useEventsStore((state) => state.events);
  const updateEvent = useEventsStore((state) => state.updateEvent);
  const deleteEvent = useEventsStore((state) => state.deleteEvent);
  const dismissed = useMustDoStore((state) => state.dismissed[trip.id]);
  const dismiss = useMustDoStore((state) => state.dismiss);
  const saveMustDo = useSaveMustDo();
  const openIdea = useOpenIdea();
  const thumbs = useIdeaThumbsStore((state) => state.thumbs);

  useEffect(() => {
    void pruneIdeaThumbs();
  }, []);
  const [filter, setFilter] = useState<PlaceFilter>("all");
  const [acting, setActing] = useState<TripEvent | null>(() => {
    const id = useSavedSheetStore.getState().open?.actingId;
    return id ? (useEventsStore.getState().events.find((event) => event.id === id) ?? null) : null;
  });
  const [notice, setNotice] = useState<string | null>(null);
  const format = formatters(locale, hour12);

  const tripEvents = events.filter((event) => event.tripId === trip.id);
  const ideas = ideasOf(tripEvents);
  const stopOf = new Map(ideas.map((idea) => [idea.id, stopIndexOf(idea, stops)]));
  const shown = ideas.filter((idea) => filter === "all" || (filter === "none" ? stopOf.get(idea.id) === null : stopOf.get(idea.id) === filter));
  const exclude = [...tripEvents.map((event) => event.title), ...(dismissed ?? [])];
  const popular = mustDosAlong(stops, locale, exclude);
  const popularCount = popular.reduce((sum, group) => sum + group.items.length, 0);

  const chips: { key: PlaceFilter; label: string }[] = [
    { key: "all", label: t("ideas.all") },
    ...stops
      .map((stop, index) => ({ key: index as PlaceFilter, label: `${stop.name.split(",")[0]} · ${ideas.filter((idea) => stopOf.get(idea.id) === index).length}` }))
      .filter((chip) => !chip.label.endsWith(" · 0")),
    ...(ideas.some((idea) => stopOf.get(idea.id) === null) ? [{ key: "none" as PlaceFilter, label: `${t("ideas.noPlace")} · ${ideas.filter((idea) => stopOf.get(idea.id) === null).length}` }] : []),
  ];

  const saverName = (idea: TripEvent) => (idea.savedBy === undefined ? null : idea.savedBy === SELF_ID ? t("itinerary.form.you") : idea.savedBy);
  // Planned trips have no dates yet: ideas can only be planned for a day once it's confirmed.
  const days =
    "startDate" in trip
      ? Array.from({ length: Math.round((fromDateKey(trip.endDate).getTime() - fromDateKey(trip.startDate).getTime()) / 86_400_000) + 1 }, (_, i) =>
          addDays(fromDateKey(trip.startDate), i),
        )
      : [];

  if (acting) {
    return (
      <Animated.View entering={FadeIn.duration(180)} style={styles.flex}>
        <View style={styles.actingHead}>
          <PressableScale onPress={() => setActing(null)} hitSlop={auraHitSlop(34)} accessibilityRole="button" accessibilityLabel={t("common.back")} style={[styles.back, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="chevronLeft" size={16} color={c.text} />
          </PressableScale>
          <Text numberOfLines={2} style={[styles.actingTitle, { color: c.text, fontFamily: f.semibold }]}>
            {t("ideas.planFor", { title: localizeEventTitle(acting.title, t) })}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.days} showsVerticalScrollIndicator={false}>
          {days.length === 0 ? (
            <Text style={[styles.hint, { color: c.textSoft, fontFamily: f.regular }]}>{t("planned.planAfterConfirm")}</Text>
          ) : null}
          {days.map((day, index) => (
            <PressableScale
              key={day.getTime()}
              onPress={() => {
                updateEvent(acting.id, { timing: "anytime", startAt: toWallClock(day) });
                track("saved_idea_action", { action: "planned", where: "saved_sheet" });
                const message = t("ideas.plannedOn", { title: localizeEventTitle(acting.title, t), day: format.dayHeader.format(day) });
                setNotice(message);
                setConfirmOnClose(message);
                setActing(null);
              }}
              accessibilityRole="button"
              style={[styles.dayRow, { borderColor: c.hairline }]}
            >
              <Text style={[styles.dayNumber, { color: c.textMuted, fontFamily: f.medium }]}>{t("ideas.dayNumber", { day: index + 1 })}</Text>
              <Text style={[styles.dayLabel, { color: c.text, fontFamily: f.medium }]}>{format.dayHeader.format(day)}</Text>
              <Icon name="chevronRight" size={13} color={c.textMuted} />
            </PressableScale>
          ))}
          <AuraButton
            label={t("ideas.remove")}
            icon="trash"
            variant="ghost"
            size="md"
            onPress={() => {
              deleteEvent(acting.id);
              track("saved_idea_action", { action: "removed", where: "saved_sheet" });
              setNotice(t("ideas.removed", { title: localizeEventTitle(acting.title, t) }));
              setActing(null);
            }}
            style={styles.remove}
          />
        </ScrollView>
      </Animated.View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.tabs}>
        <AuraChip label={t("ideas.yourIdeas", { count: ideas.length })} selected={tab === "ideas"} onPress={() => setTab("ideas")} />
        {popularCount > 0 ? <AuraChip label={t("ideas.popular", { count: popularCount })} selected={tab === "popular"} onPress={() => setTab("popular")} /> : null}
      </View>
      {notice ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.notice}>
          <Icon name="check" size={14} color={auraSignal.ready} />
          <Text numberOfLines={2} style={[styles.noticeText, { color: c.textSoft, fontFamily: f.medium }]}>
            {notice}
          </Text>
        </Animated.View>
      ) : null}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {tab === "popular" || ideas.length === 0 ? null : chips.length > 2 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {chips.map((chip) => (
              <AuraChip key={String(chip.key)} label={chip.label} selected={filter === chip.key} onPress={() => setFilter(chip.key)} />
            ))}
          </ScrollView>
        ) : null}
        {tab === "ideas" ? (
          shown.length > 0 ? (
            <View style={styles.grid}>
              {shown.map((idea) => {
                const index = stopOf.get(idea.id);
                const meta = [index !== null && index !== undefined && stops.length > 1 ? stops[index].name.split(",")[0] : null, saverName(idea)].filter(Boolean).join(" · ");
                return (
                  <Animated.View key={idea.id} layout={LinearTransition.duration(220)} exiting={FadeOut.duration(160)} style={styles.cell}>
                    <PressableScale
                      onPress={() => {
                        if (openIdea(idea)) return;
                        setNotice(null);
                        setActing(idea);
                      }}
                      onLongPress={() => {
                        setNotice(null);
                        setActing(idea);
                      }}
                      pressedScale={0.97}
                      accessibilityRole="button"
                      accessibilityHint={idea.link ? t("ideas.cardHintLink") : t("ideas.cardHint")}
                      style={[styles.card, { borderColor: c.textMuted }]}
                    >
                      {idea.link ? (
                        <View style={[styles.media, { backgroundColor: c.surfaceStrong }]}>
                          {thumbs[idea.id] || idea.link.thumbnail ? (
                            <Image source={{ uri: thumbs[idea.id] ?? idea.link.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={idea.id} cachePolicy="memory-disk" />
                          ) : (
                            <Icon name={idea.link.provider === "web" ? "globe" : "play"} size={26} color={c.textSoft} />
                          )}
                          <View style={styles.badge}>
                            <Text numberOfLines={1} style={[styles.badgeText, { fontFamily: f.semibold }]}>
                              {idea.link.provider === "web" ? hostOf(idea.link.url) : PROVIDER_NAME[idea.link.provider]}
                            </Text>
                          </View>
                          {idea.link.provider !== "web" ? (
                            <View style={styles.play}>
                              <Icon name="play" size={12} color="#FFFFFF" />
                            </View>
                          ) : null}
                        </View>
                      ) : (
                        <View style={[styles.tile, { backgroundColor: `${auraEventColors[idea.type]}22` }]}>
                          <Icon name={getEventTypeMeta(idea.type).icon} size={22} color={auraEventColors[idea.type]} />
                        </View>
                      )}
                      <View style={styles.cardText}>
                        <Text numberOfLines={2} style={[styles.cardTitle, { color: c.text, fontFamily: f.semibold }]}>
                          {localizeEventTitle(idea.title, t)}
                        </Text>
                        {idea.note ? (
                          <Text numberOfLines={2} style={[styles.cardMeta, { color: c.textSoft, fontFamily: f.regular }]}>
                            “{idea.note}”
                          </Text>
                        ) : null}
                        {meta ? (
                          <Text numberOfLines={1} style={[styles.cardMeta, { color: c.textMuted, fontFamily: f.regular }]}>
                            {meta}
                          </Text>
                        ) : null}
                      </View>
                    </PressableScale>
                  </Animated.View>
                );
              })}
            </View>
          ) : (
            <AuraEmptyState
              plain
              icon="bookmark"
              body={t("ideas.empty")}
              action={popularCount > 0 ? <AuraButton label={t("ideas.seePopular")} variant="secondary" size="md" onPress={() => setTab("popular")} /> : undefined}
            />
          )
        ) : (
          popular.map((group) => (
            <View key={group.place} style={styles.popularGroup}>
              <Text style={[styles.label, { color: c.textSoft, fontFamily: f.semibold }]}>{t("itinerary.mustDo.title", { place: group.place })}</Text>
              {group.items.map((item) => (
                <Animated.View key={item.key} layout={LinearTransition.duration(220)} exiting={FadeOut.duration(160)}>
                  <MustDoRow
                    item={item}
                    actionLabel={t("home.prep.save")}
                    onAdd={() => {
                      saveMustDo(trip, item, "saved_sheet");
                      setNotice(t("ideas.savedNotice", { title: item.name }));
                    }}
                    onDismiss={() => {
                      track("must_do_suggestion", { action: "dismissed", where: "saved_sheet" });
                      dismiss(trip.id, item.key);
                    }}
                  />
                </Animated.View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  noticeText: { flex: 1, fontSize: 13 },
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  chips: { gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5 },
  cell: { width: "50%", padding: 5 },
  card: { borderRadius: 16, borderWidth: 1.2, borderStyle: "dashed", overflow: "hidden" },
  tile: { height: 72, alignItems: "center", justifyContent: "center" },
  media: { height: 132, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  badge: { position: "absolute", top: 6, left: 6, maxWidth: "80%", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.55)" },
  badgeText: { color: "#FFFFFF", fontSize: 10 },
  play: { position: "absolute", right: 6, bottom: 6, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  cardText: { padding: 10, gap: 3 },
  cardTitle: { fontSize: 14, lineHeight: 18 },
  cardMeta: { fontSize: 12 },
  popularGroup: { gap: 14 },
  label: { fontSize: 11.5, letterSpacing: 0.8, textTransform: "uppercase" },
  actingHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  back: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  actingTitle: { flex: 1, fontSize: 16 },
  days: { paddingHorizontal: 20, paddingBottom: 24 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  dayNumber: { width: 52, fontSize: 13 },
  dayLabel: { flex: 1, fontSize: 15 },
  remove: { alignSelf: "flex-start", marginTop: 16 },
  hint: { fontSize: 14, lineHeight: 20, paddingVertical: 8 },
});
