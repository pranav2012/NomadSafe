import React, { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraField } from "@/components/aura/AuraField";
import { AuraSheet } from "@/components/aura/AuraSheet";
import { useAura } from "@/components/aura/useAura";
import { auraStatusColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { TripFormSheet } from "@/features/trips/components/TripForm";
import { isArchived, TripPeopleSheet } from "@/features/trips/components/TripPeopleSheet";
import { selectActiveTrip, type Trip, useTripsStore } from "@/features/trips/store/tripsStore";
import { countInclusiveDays, fromDateKey, getTripStatus, startOfLocalDay } from "@/features/trips/utils/dates";
import { useChatStore } from "@/features/ai/store/chatStore";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { clearTripGmailCoverage } from "@/features/expenses/store/tripGmailCoverageStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { selectionChanged } from "@/utils/haptics";

type SectionKey = "current" | "upcoming" | "past" | "archived";

interface TripSection {
  key: SectionKey;
  data: Trip[];
}

function countDays(trip: Trip) {
  return countInclusiveDays(fromDateKey(trip.startDate), fromDateKey(trip.endDate));
}

function formatTripDates(trip: Trip, locale: string) {
  const start = fromDateKey(trip.startDate);
  const end = fromDateKey(trip.endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const endFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  return `${startFormatter.format(start)} — ${endFormatter.format(end)}`;
}

function byStartDate(a: Trip, b: Trip) {
  return fromDateKey(a.startDate).getTime() - fromDateKey(b.startDate).getTime();
}

/** Accepts the localized confirm word (as the prompt instructs) or English "confirm". */
function matchesConfirmWord(input: string, localizedWord: string, locale: string) {
  const typed = input.trim().toLocaleLowerCase(locale);
  if (!typed) return false;
  return typed === localizedWord.trim().toLocaleLowerCase(locale) || typed === "confirm";
}

const OVERLAP = 104;

function code(name: string | undefined) {
  return (name ?? "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "—";
}

/** Day progress of a running trip (0..1), 0 before it starts and 1 after it ends. */
function tripProgress(trip: Trip) {
  const status = getTripStatus(trip);
  if (status === "upcoming") return 0;
  if (status === "complete") return 1;
  const total = countDays(trip);
  const elapsed = countInclusiveDays(fromDateKey(trip.startDate), startOfLocalDay(new Date()));
  return Math.min(1, elapsed / Math.max(1, total));
}

/**
 * Trips as a Wallet-style stack of passes. The active trip sits on top, open; other trips overlap
 * by section (now, upcoming, past) and spring open on tap to reveal Switch, Edit and Delete.
 */
export default function TripsScreen() {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const trips = useTripsStore((state) => state.trips);
  const activeTrip = useTripsStore(selectActiveTrip);
  const setActiveTrip = useTripsStore((state) => state.setActiveTrip);
  const deleteTrip = useTripsStore((state) => state.deleteTrip);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ trip: Trip | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Trip | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [peopleFor, setPeopleFor] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const setPreferences = useMutation(api.groupTrips.setPreferences);

  // Archiving a shared trip only hides it from this user's list; it stays live for everyone else.
  const toggleArchive = (trip: Trip) => {
    if (!trip.shared) return;
    const archived = !trip.shared.archived;
    setPreferences({ tripId: trip.shared.tripId as Id<"sharedTrips">, archived }).catch(() =>
      Alert.alert(t("groupTrip.actionFailed")),
    );
    if (archived && trip.id === activeTrip?.id) useTripsStore.getState().clearActiveTrip();
  };

  const submitJoinCode = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoinOpen(false);
    setJoinCode("");
    router.push({ pathname: "/join/[code]", params: { code } });
  };

  const sections = useMemo<TripSection[]>(() => {
    const remaining = trips.filter((trip) => trip.id !== activeTrip?.id && !isArchived(trip));
    const grouped: TripSection[] = [
      { key: "current", data: remaining.filter((trip) => getTripStatus(trip) === "active").sort(byStartDate) },
      { key: "upcoming", data: remaining.filter((trip) => getTripStatus(trip) === "upcoming").sort(byStartDate) },
      { key: "past", data: remaining.filter((trip) => getTripStatus(trip) === "complete").sort((a, b) => byStartDate(b, a)) },
      { key: "archived", data: trips.filter((trip) => isArchived(trip) && trip.id !== activeTrip?.id).sort((a, b) => byStartDate(b, a)) },
    ];
    return grouped.filter((section) => section.data.length > 0);
  }, [trips, activeTrip]);

  const sectionLabels: Record<SectionKey, string> = {
    current: t("trip.happeningNow"),
    upcoming: t("trip.upcoming"),
    past: t("trip.past"),
    archived: t("groupTrip.archivedSection"),
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (!matchesConfirmWord(confirmText, t("trip.deletePlaceholder"), locale)) {
      Alert.alert(t("trip.deleteConfirmErrorTitle"), t("trip.deleteConfirmErrorBody"));
      return;
    }
    const tripId = deleteTarget.id;
    deleteTrip(tripId);
    useEventsStore.getState().removeByTripId(tripId);
    useExpensesStore.getState().removeByTripId(tripId);
    useChatStore.getState().removeConversation(tripId);
    clearTripGmailCoverage(tripId);
    setDeleteTarget(null);
    setConfirmText("");
  };

  const renderPass = (trip: Trip, opts: { active: boolean; overlap: boolean; index: number }) => (
    <TripPass
      key={trip.id}
      trip={trip}
      active={opts.active}
      expanded={opts.active || expandedId === trip.id}
      overlap={opts.overlap}
      index={opts.index}
      onPress={() => {
        if (opts.active) {
          router.back();
          return;
        }
        selectionChanged();
        setExpandedId((current) => (current === trip.id ? null : trip.id));
      }}
      onSwitch={() => {
        setActiveTrip(trip.id);
        router.back();
      }}
      onEdit={() => setForm({ trip })}
      onPeople={() => setPeopleFor(trip.id)}
      onDelete={() => {
        if (trip.shared) {
          toggleArchive(trip);
          return;
        }
        setDeleteTarget(trip);
        setConfirmText("");
      }}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={[styles.count, { color: c.textMuted, fontFamily: f.medium }]}>{t("trip.tripsCount", { count: trips.length })}</Text>
            <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("trip.tripsTitle")}</Text>
          </View>
          <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("trip.close")} style={[styles.close, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
        </View>

        {trips.length === 0 ? (
          <Animated.View entering={FadeIn.duration(300)} style={[styles.empty, { backgroundColor: c.surface, borderColor: c.hairline }]}>
            <Icon name="compass" size={22} color={c.textSoft} />
            <Text style={[styles.emptyTitle, { color: c.text, fontFamily: f.semibold }]}>{t("trip.noTripsTitle")}</Text>
            <Text style={[styles.emptyBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("trip.noTripsBody")}</Text>
          </Animated.View>
        ) : null}

        {activeTrip ? (
          <>
            <Text style={[styles.section, { color: c.textSoft, fontFamily: f.medium }]}>{t("trip.activeNow")}</Text>
            {renderPass(activeTrip, { active: true, overlap: false, index: 0 })}
          </>
        ) : null}

        {sections.map((section) => (
          <View key={section.key}>
            <Text style={[styles.section, { color: c.textSoft, fontFamily: f.medium }]}>{sectionLabels[section.key]}</Text>
            {section.data.map((trip, index) => renderPass(trip, { active: false, overlap: index > 0, index }))}
          </View>
        ))}

        <AuraButton label={t("trip.addTrip")} icon="plus" variant="secondary" onPress={() => setForm({ trip: null })} style={styles.add} />
        <AuraButton label={t("groupTrip.joinWithCode")} icon="users" variant="ghost" onPress={() => setJoinOpen(true)} style={styles.join} />
      </ScrollView>

      <TripFormSheet visible={form !== null} editingTrip={form?.trip ?? null} onClose={() => setForm(null)} />
      <TripPeopleSheet tripId={peopleFor} onClose={() => setPeopleFor(null)} />

      <AuraSheet
        visible={joinOpen}
        onClose={() => setJoinOpen(false)}
        title={t("groupTrip.joinCodeTitle")}
        subtitle={t("groupTrip.joinCodeBody")}
        footer={<AuraButton label={t("groupTrip.joinButton")} onPress={submitJoinCode} disabled={!joinCode.trim()} />}
      >
        <View style={styles.deleteBody}>
          <AuraField
            value={joinCode}
            onChangeText={setJoinCode}
            placeholder={t("groupTrip.joinCodePlaceholder")}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={16}
            autoFocus
            onSubmitEditing={submitJoinCode}
          />
        </View>
      </AuraSheet>

      <AuraSheet
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("trip.deleteTitle")}
        footer={
          <View style={styles.actions}>
            <AuraButton label={t("common.cancel")} variant="secondary" onPress={() => setDeleteTarget(null)} style={styles.flex} />
            <AuraButton
              label={t("trip.deleteConfirm")}
              icon="trash"
              variant="danger"
              disabled={!matchesConfirmWord(confirmText, t("trip.deletePlaceholder"), locale)}
              onPress={confirmDelete}
              style={styles.flex}
            />
          </View>
        }
      >
        <View style={styles.deleteBody}>
          <Text style={[styles.deleteText, { color: c.textSoft, fontFamily: f.regular }]}>
            {deleteTarget ? t("trip.deleteBody", { name: deleteTarget.name }) : ""}
          </Text>
          <AuraField
            label={t("trip.deletePrompt")}
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={t("trip.deletePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </View>
      </AuraSheet>
    </View>
  );
}

function TripPass({
  trip,
  active,
  expanded,
  overlap,
  index,
  onPress,
  onSwitch,
  onEdit,
  onPeople,
  onDelete,
}: {
  trip: Trip;
  active: boolean;
  expanded: boolean;
  overlap: boolean;
  index: number;
  onPress: () => void;
  onSwitch: () => void;
  onEdit: () => void;
  onPeople: () => void;
  onDelete: () => void;
}) {
  const { c, f, isDark } = useAura();
  const { t, locale } = useLocalization();
  const status = getTripStatus(trip);
  const tint = active ? auraStatusColors.calm : status === "complete" ? ["#5A6072", "#3A3F4D", "#2A2E39"] : ["#9B7BFF", "#5B6CFF", "#22C7B8"];
  const progress = tripProgress(trip);
  const from = trip.destinations[0];
  const to = trip.destinations[trip.destinations.length - 1];
  const many = trip.destinations.length > 1;
  const peopleLabel = trip.shared ? t("groupTrip.peopleButton") : t("groupTrip.shareButton");
  // Shared trips are archived from your own list rather than deleted for everyone.
  const removeLabel = trip.shared ? (trip.shared.archived ? t("groupTrip.unarchive") : t("groupTrip.archive")) : t("trip.delete");
  const removeIcon = trip.shared ? "bookmark" : "trash";

  return (
    <Animated.View
      entering={FadeInDown.duration(260).delay(Math.min(index, 6) * 50)}
      layout={LinearTransition.springify().damping(18).stiffness(180)}
      style={[styles.passWrap, { marginTop: overlap && !expanded ? -OVERLAP : 12, zIndex: index }]}
    >
      <PressableScale onPress={onPress} pressedScale={0.985} accessibilityRole="button" accessibilityLabel={trip.name} accessibilityState={{ expanded }} style={[styles.pass, { backgroundColor: c.card, borderColor: c.highlight }]}>
        <LinearGradient
          colors={[`${tint[0]}${isDark ? "40" : "30"}`, `${tint[1]}${isDark ? "26" : "1C"}`, `${tint[2]}${isDark ? "1A" : "12"}`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.passTop}>
          <View style={styles.flex}>
            <Text numberOfLines={1} style={[styles.passName, { color: c.text, fontFamily: f.semibold }]}>
              {trip.name}
            </Text>
            <Text numberOfLines={1} style={[styles.passDates, { color: c.textSoft, fontFamily: f.regular }]}>
              {formatTripDates(trip, locale)} · {t("trip.daysCount", { count: countDays(trip) })}
            </Text>
          </View>
          {active ? (
            <View style={[styles.badge, { backgroundColor: c.inverse }]}>
              <Text style={[styles.badgeText, { color: c.onInverse, fontFamily: f.semibold }]}>{t("trip.currentTrip")}</Text>
            </View>
          ) : (
            <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} color={c.textMuted} />
          )}
        </View>

        <View style={styles.route}>
          <Text style={[styles.code, { color: c.text, fontFamily: f.semibold }]}>{code(from)}</Text>
          {many ? (
            <>
              <View style={styles.line}>
                <View style={[styles.dash, { borderColor: c.textMuted }]} />
                <Icon name="send" size={13} color={c.textSoft} />
                <View style={[styles.dash, { borderColor: c.textMuted }]} />
              </View>
              <Text style={[styles.code, { color: c.text, fontFamily: f.semibold }]}>{code(to)}</Text>
            </>
          ) : (
            <Text numberOfLines={1} style={[styles.city, { color: c.textSoft, fontFamily: f.regular }]}>
              {from}
            </Text>
          )}
        </View>
        <View style={[styles.track, { backgroundColor: c.hairline }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: c.text }]} />
        </View>

        {expanded && !active ? (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={styles.passActions}>
            <AuraButton label={t("trip.open")} size="md" onPress={onSwitch} style={styles.flex} />
            <AuraButton label={t("trip.edit")} icon="edit" variant="secondary" size="md" onPress={onEdit} />
            <AuraButton label={peopleLabel} icon="users" variant="secondary" size="md" onPress={onPeople} />
            <AuraButton label={removeLabel} icon={removeIcon} variant="secondary" size="md" onPress={onDelete} />
          </Animated.View>
        ) : null}
        {active ? (
          <View style={styles.passActions}>
            <AuraButton label={t("trip.edit")} icon="edit" variant="secondary" size="md" onPress={onEdit} style={styles.flex} />
            <AuraButton label={peopleLabel} icon="users" variant="secondary" size="md" onPress={onPeople} style={styles.flex} />
            <AuraButton label={removeLabel} icon={removeIcon} variant="secondary" size="md" onPress={onDelete} style={styles.flex} />
          </View>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 8 },
  count: { fontSize: 13.5 },
  title: { fontSize: 34, letterSpacing: -1.2 },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginTop: 4 },
  section: { fontSize: 13.5, marginTop: 22 },
  empty: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 8, marginTop: 16 },
  emptyTitle: { fontSize: 18 },
  emptyBody: { fontSize: 14.5, lineHeight: 21 },
  passWrap: {},
  pass: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12, overflow: "hidden" },
  passTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  passName: { fontSize: 17, letterSpacing: -0.2 },
  passDates: { fontSize: 13, marginTop: 2 },
  badge: { paddingHorizontal: 10, height: 24, borderRadius: 12, justifyContent: "center" },
  badgeText: { fontSize: 11.5 },
  route: { flexDirection: "row", alignItems: "center", gap: 10 },
  code: { fontSize: 28, letterSpacing: 0.8 },
  city: { fontSize: 14, flexShrink: 1 },
  line: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  dash: { flex: 1, borderTopWidth: 1, borderStyle: "dashed" },
  track: { height: 3, borderRadius: 2, overflow: "hidden" },
  fill: { height: 3, borderRadius: 2 },
  passActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  add: { marginTop: 24 },
  join: { marginTop: 8 },
  actions: { flexDirection: "row", gap: 10 },
  deleteBody: { paddingHorizontal: 20, paddingBottom: 8, gap: 14 },
  deleteText: { fontSize: 15, lineHeight: 22 },
});
