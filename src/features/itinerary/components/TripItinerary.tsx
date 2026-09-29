import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { localModelService, useAiReadyModelId } from "@/features/ai";
import { useSettingsStore } from "@/features/settings";
import type { Trip } from "@/features/trips/store/tripsStore";
import {
  useEventsStore,
  type TripEvent,
} from "@/features/itinerary/store/eventsStore";
import { getEventTypeMeta } from "@/features/itinerary/constants/eventTypes";
import { EventForm, type EventFormValues } from "@/features/itinerary/components/EventForm";
import { localizeEventDetail, localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { logger } from "@/services/logger";

type ThemeColors = ReturnType<typeof useTheme>["nomad"]["colors"];
type Translate = ReturnType<typeof useLocalization>["t"];

const PREVIEW_COUNT = 3;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Returns the next upcoming events first, falling back to the most recent ones. */
function pickPreview(ordered: TripEvent[]): TripEvent[] {
  const today = startOfDay(new Date());
  const upcoming = ordered.filter((event) => startOfDay(new Date(event.startAt)) >= today);
  if (upcoming.length > 0) return upcoming.slice(0, PREVIEW_COUNT);
  return ordered.slice(-PREVIEW_COUNT);
}

/** Keeps an edited event's duration by moving `endAt` along with `startAt`. */
function shiftEndAt(event: TripEvent, startAt: string): string | undefined {
  if (!event.endAt) return undefined;
  const delta = new Date(startAt).getTime() - new Date(event.startAt).getTime();
  const end = new Date(new Date(event.endAt).getTime() + delta);
  return Number.isNaN(end.getTime()) ? event.endAt : end.toISOString();
}

export function TripItinerary({ trip }: { trip: Trip }) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, locale } = useLocalization();
  const events = useEventsStore((state) => state.events);
  const addEvent = useEventsStore((state) => state.addEvent);
  const updateEvent = useEventsStore((state) => state.updateEvent);
  const deleteEvent = useEventsStore((state) => state.deleteEvent);
  const deleteEvents = useEventsStore((state) => state.deleteEvents);
  const localAiEnabled = useSettingsStore((state) => state.localAiEnabled);
  const aiReadyModelId = useAiReadyModelId();

  const [expanded, setExpanded] = useState(false);
  const [isAiAvailable, setIsAiAvailable] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  // `null` = closed; "new" = add form; otherwise the event being edited.
  const [editing, setEditing] = useState<TripEvent | "new" | null>(null);

  const ordered = useMemo(
    () =>
      events
        .filter((event) => event.tripId === trip.id)
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [events, trip.id],
  );

  const preview = useMemo(() => pickPreview(ordered), [ordered]);
  const visible = expanded ? ordered : preview;
  const canExpand = ordered.length > visible.length || (expanded && ordered.length > PREVIEW_COUNT);

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
      addEvent({
        tripId: trip.id,
        type: values.type,
        title: values.title,
        detail: values.detail || undefined,
        startAt: values.startAt,
        source: "manual",
      });
    }
    setEditing(null);
  };

  const handleDelete = () => {
    if (editing && editing !== "new") deleteEvent(editing.id);
    setEditing(null);
  };

  const handleRefine = useCallback(async () => {
    if (isRefining || ordered.length === 0) return;

    setIsRefining(true);
    try {
      const refinement = await localModelService.refineItinerary(ordered);
      const idsToDelete = ordered
        .filter((event) => !refinement.keepIds.includes(event.id))
        .map((event) => event.id);

      if (idsToDelete.length === 0) {
        Alert.alert(t("itinerary.refineNoneTitle"), t("itinerary.refineNoneBody"));
        return;
      }

      Alert.alert(
        t("itinerary.refineReviewTitle"),
        t("itinerary.refineReviewBody", {
          keep: refinement.keepIds.length,
          remove: idsToDelete.length,
        }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("itinerary.refineApply"),
            style: "destructive",
            onPress: () => deleteEvents(idsToDelete),
          },
        ],
      );
    } catch (error) {
      logger.warn("itinerary-refinement", "failed", error);
      Alert.alert(t("itinerary.refineErrorTitle"), t("itinerary.refineErrorBody"));
    } finally {
      await localModelService.release();
      setIsRefining(false);
    }
  }, [deleteEvents, isRefining, ordered, t]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>{t("itinerary.title")}</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setEditing("new")}
            hitSlop={8}
            style={({ pressed }) => [
              styles.addPill,
              { backgroundColor: theme.tealSoft, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Icon name="plus" size={12} color={theme.teal} />
            <Text style={[styles.addPillText, { color: theme.teal }]}>{t("itinerary.add")}</Text>
          </Pressable>
          {isAiAvailable ? (
            <Pressable
              onPress={handleRefine}
              disabled={isRefining || ordered.length === 0}
              hitSlop={8}
              style={({ pressed }) => [
                styles.addPill,
                {
                  backgroundColor: theme.mustardSoft,
                  opacity: pressed || isRefining || ordered.length === 0 ? 0.55 : 1,
                },
              ]}
            >
              <Icon name="sparkle" size={12} color={theme.mustard} />
              <Text style={[styles.addPillText, { color: theme.mustard }]}>
                {isRefining ? t("itinerary.refining") : t("itinerary.refine")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {ordered.length === 0 ? (
        <Pressable
          onPress={() => setEditing("new")}
          style={[styles.empty, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}
        >
          <Icon name="calendar" size={18} color={theme.inkMuted} />
          <Text style={[styles.emptyText, { color: theme.inkSoft }]}>
            {t("itinerary.empty")}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.list}>
          {visible.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              theme={theme}
              locale={locale}
              t={t}
              onPress={() => setEditing(event)}
            />
          ))}
        </View>
      )}

      {canExpand ? (
        <Pressable
          onPress={() => setExpanded((open) => !open)}
          style={({ pressed }) => [styles.expandRow, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.expandText, { color: theme.teal }]}>
            {expanded ? t("itinerary.showLess") : t("itinerary.viewAll", { count: ordered.length })}
          </Text>
          <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
            <Icon name="chevronDown" size={14} color={theme.teal} />
          </View>
        </Pressable>
      ) : null}

      <EventForm
        key={editing === "new" ? "new" : editing ? editing.id : "closed"}
        event={editing && editing !== "new" ? editing : null}
        visible={editing !== null}
        onSave={handleSave}
        onDelete={editing && editing !== "new" ? handleDelete : undefined}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

function EventRow({
  event,
  theme,
  locale,
  t,
  onPress,
}: {
  event: TripEvent;
  theme: ThemeColors;
  locale: string;
  t: Translate;
  onPress: () => void;
}) {
  const meta = getEventTypeMeta(event.type);
  const date = new Date(event.startAt);
  const isToday = startOfDay(date) === startOfDay(new Date());
  const weekday = isToday
    ? t("itinerary.today")
    : new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  const subtitle = [time, localizeEventDetail(event.detail, t)].filter(Boolean).join("  ·  ");

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.paperSoft, borderColor: theme.hairline, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={styles.dateBadge}>
        <Text style={[styles.dateWeekday, { color: theme[meta.color] }]} numberOfLines={1}>
          {weekday.toLocaleUpperCase(locale)}
        </Text>
        <Text style={[styles.dateDay, { color: theme.inkDeep }]}>{date.getDate()}</Text>
      </View>

      <View style={styles.rowBody}>
        <View style={[styles.typePill, { backgroundColor: theme[meta.soft] }]}>
          <Text style={[styles.typePillText, { color: theme[meta.color] }]}>
            {t(`itinerary.types.${event.type}`).toLocaleUpperCase(locale)}
          </Text>
        </View>
        <Text style={[styles.rowTitle, { color: theme.inkDeep }]} numberOfLines={1}>
          {localizeEventTitle(event.title, t)}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSub, { color: theme.inkSoft }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <Icon name="chevronRight" size={18} color={theme.inkMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  eyebrow: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  addPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  addPillText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  list: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  dateBadge: {
    alignItems: "center",
    width: 40,
  },
  dateWeekday: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 9.5,
    letterSpacing: 1,
  },
  dateDay: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 30,
    lineHeight: 34,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  typePill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typePillText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
  },
  rowTitle: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 16,
  },
  rowSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12.5,
  },
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  emptyText: {
    flex: 1,
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  expandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 4,
  },
  expandText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
  },
});
