import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuraButton, AuraField, Icon, PressableScale, showToast, useAura, type IconName } from "@/atoms";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { canCreatePlannedTrip, usePlanStore } from "@/modules/billing";
import { SELF_ID } from "@/features/expenses/utils/split";
import { fetchLinkPreview, type LinkPreview } from "@/features/itinerary/services/linkPreview";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useSavedSheetStore } from "@/features/itinerary/store/savedSheetStore";
import { saveTargets, type DetectedPlace, type SaveChoice, type SaveTarget } from "@/features/itinerary/utils/saveTargets";
import { captionOf, classifyLink, extractLink, type LinkProvider } from "@/features/itinerary/utils/sharedLinks";
import { toWallClock } from "@/features/itinerary/utils/wallClock";
import { DestinationSearch } from "@/features/trips/components/DestinationSearch";
import { findOfflineCoordinates, findPlaceInText } from "@/features/trips/data/destinations";
import { geocodeDestination } from "@/features/trips/services/geocoding";
import { getDestinationCoordinates, isArchivedGroup, useTripsStore } from "@/features/trips/store/tripsStore";
import { fromDateKey, toDateKey } from "@/features/trips/utils/dates";
import { destinationCity } from "@/features/trips/utils/tripName";

const PROVIDER_ICON: Record<LinkProvider, IconName> = { instagram: "camera", tiktok: "play", youtube: "play", web: "globe" };
const PROVIDER_NAME: Record<Exclude<LinkProvider, "web">, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

/** "Save idea" for a link shared from another app: preview, note, and which trip (defaulting from the place it names). */
export default function SaveLinkScreen() {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ text?: string }>();
  const [shared] = useState(() => params.text ?? "");
  const raw = extractLink(shared);
  const link = raw ? classifyLink(raw) : null;
  const caption = captionOf(shared, raw);
  const [preview, setPreview] = useState<LinkPreview | null>(link ? null : {});
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<DetectedPlace | null>(null);
  const [override, setOverride] = useState<SaveChoice | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const trips = useTripsStore((state) => state.trips);
  const plannedTrips = useTripsStore((state) => state.plannedTrips);
  const activeTripId = useTripsStore((state) => state.activeTripId);

  useEffect(() => {
    if (!shared.trim()) {
      router.back();
      return;
    }
    if (!link) return;
    let live = true;
    void fetchLinkPreview(link).then((result) => {
      if (live) setPreview(result);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detected = useMemo(() => findPlaceInText([preview?.title, caption].filter(Boolean).join(" · "), locale), [caption, locale, preview?.title]);
  const place: DetectedPlace | null = picked ?? detected;
  const today = toDateKey(new Date());
  const targets: SaveTarget[] = [
    ...trips
      .filter((trip) => !isArchivedGroup(trip) && trip.endDate >= today)
      .map((trip) => ({ id: trip.id, name: trip.name, kind: "trip" as const, destinations: trip.destinations, coordinates: getDestinationCoordinates(trip), startDate: trip.startDate })),
    ...plannedTrips.map((planned) => ({ id: planned.id, name: planned.name, kind: "planned" as const, destinations: planned.destinations, coordinates: planned.destinationCoordinates ?? [] })),
  ];
  const { ordered, choice: suggested } = saveTargets(targets, activeTripId, preview === null ? null : place);
  const choice = override ?? suggested;
  const title = preview?.title || caption.slice(0, 140) || (link ? (link.provider === "web" ? new URL(link.url).hostname.replace(/^www\./, "") : PROVIDER_NAME[link.provider]) : "");
  const source = link ? (link.provider === "web" ? new URL(link.url).hostname.replace(/^www\./, "") : PROVIDER_NAME[link.provider]) : null;
  const author = preview?.author ?? link?.author;

  const save = async () => {
    if (!choice || saving || !title) return;
    if (choice.kind === "new" && !place) return;
    setSaving(true);
    try {
      let tripId: string;
      let tripName: string;
      let startDate: string | undefined;
      if (choice.kind === "new") {
        if (!canCreatePlannedTrip(useTripsStore.getState().plannedTrips, usePlanStore.getState())) {
          track("planned_trip_limit_reached");
          router.replace({ pathname: "/paywall", params: { reason: "planned" } });
          return;
        }
        const coordinates = place!.coordinates ?? findOfflineCoordinates(place!.label, locale) ?? (await geocodeDestination(place!.label));
        const created = useTripsStore.getState().createPlannedTrip({ name: destinationCity(place!.label), destinations: [place!.label], destinationCoordinates: [coordinates] });
        track("planned_trip", { action: "created", destinations: 1, had_month: false });
        tripId = created.id;
        tripName = created.name;
      } else {
        const target = targets.find((item) => item.id === choice.id);
        if (!target) return;
        tripId = target.id;
        tripName = target.name;
        startDate = target.startDate;
      }

      const showIdeas = () => useSavedSheetStore.getState().show(tripId, "ideas", "toast");
      const duplicate = link && useEventsStore.getState().events.some((event) => event.tripId === tripId && event.link?.url === link.url);
      if (!duplicate) {
        useEventsStore.getState().addEvent({
          tripId,
          type: "activity",
          title,
          startAt: toWallClock(startDate ? fromDateKey(startDate) : new Date()),
          timing: "wishlist",
          source: "manual",
          savedBy: SELF_ID,
          note: note.trim() || undefined,
          place: place?.coordinates ? { name: place.label, ...place.coordinates } : undefined,
          link: link ? { url: link.url, provider: link.provider, author, thumbnail: preview?.thumbnail } : undefined,
        });
      }
      track("link_saved", { provider: link?.provider ?? "text", detected: Boolean(detected), target: choice.kind === "new" ? "new_planned" : (targets.find((item) => item.id === tripId)?.kind ?? "trip"), duplicate: Boolean(duplicate) });
      router.back();
      showToast(duplicate ? t("saveLink.alreadySaved", { trip: tripName }) : t("ideas.savedTitle", { trip: tripName }), duplicate ? undefined : title, { label: t("ideas.view"), onPress: showIdeas });
    } finally {
      setSaving(false);
    }
  };

  const row = (key: string, selected: boolean, icon: IconName, label: string, detail: string | undefined, onPress: () => void, dashed = false) => (
    <PressableScale
      key={key}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.row, { borderColor: selected ? c.text : c.hairline, backgroundColor: selected ? c.surfaceStrong : c.surface }, dashed && styles.dashed]}
    >
      <Icon name={icon} size={16} color={c.textSoft} />
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.rowLabel, { color: c.text, fontFamily: f.semibold }]}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={[styles.rowDetail, { color: c.textMuted, fontFamily: f.regular }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={[styles.radio, { borderColor: selected ? c.text : c.textMuted }]}>{selected ? <View style={[styles.radioDot, { backgroundColor: c.text }]} /> : null}</View>
    </PressableScale>
  );

  const isChosen = (id: string) => choice?.kind === "existing" && choice.id === id;
  const newLabel = place ? t("saveLink.newPlannedAt", { place: destinationCity(place.label) }) : t("saveLink.newPlanned");

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("saveLink.title")}</Text>
          <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.close")} style={[styles.close, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="x" size={16} color={c.text} />
          </PressableScale>
        </View>

        <PrivateView style={[styles.preview, { borderColor: c.textMuted }]}>
          {preview?.thumbnail ? (
            <Image source={{ uri: preview.thumbnail }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: c.surfaceStrong }]}>
              <Icon name={link ? PROVIDER_ICON[link.provider] : "bookmark"} size={22} color={c.textSoft} />
            </View>
          )}
          <View style={styles.flex}>
            <Text numberOfLines={3} style={[styles.previewTitle, { color: c.text, fontFamily: f.semibold }]}>
              {preview === null ? t("saveLink.loading") : title || t("saveLink.noLink")}
            </Text>
            {source ? (
              <Text numberOfLines={1} style={[styles.rowDetail, { color: c.textMuted, fontFamily: f.regular }]}>
                {[source, author].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
          </View>
        </PrivateView>

        <AuraField label={t("saveLink.noteLabel")} value={note} onChangeText={setNote} placeholder={t("saveLink.notePlaceholder")} maxLength={300} />

        <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("saveLink.saveTo")}</Text>
        {place && !picked ? (
          <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("saveLink.detected", { place: place.label })}</Text>
        ) : null}
        <View style={styles.list}>
          {ordered.map((target) =>
            row(
              target.id,
              isChosen(target.id),
              target.kind === "planned" ? "bookmark" : "plane",
              target.name,
              target.kind === "planned" ? t("planned.badge") : target.id === activeTripId ? t("saveLink.currentTrip") : undefined,
              () => setOverride({ kind: "existing", id: target.id }),
              target.kind === "planned",
            ),
          )}
          {row("new", choice?.kind === "new", "plus", newLabel, t("saveLink.newPlannedDetail"), () => setOverride({ kind: "new" }), true)}
        </View>
        {choice?.kind === "new" || choice === null ? (
          <View style={styles.where}>
            <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{t("saveLink.whereIsThis")}</Text>
            <DestinationSearch
              selected={place ? [place.label] : []}
              onSelect={(label) => {
                setPicked({ label, kind: "city", coordinates: findOfflineCoordinates(label, locale) ?? undefined });
                setOverride(undefined);
              }}
            />
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: c.bg }]}>
        <AuraButton
          label={t("saveLink.save")}
          icon="bookmark"
          loading={saving}
          disabled={!choice || !title || (choice.kind === "new" && !place)}
          onPress={() => void save()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  title: { flex: 1, fontSize: 30, letterSpacing: -0.9 },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  preview: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 18, borderWidth: 1.2, borderStyle: "dashed", alignItems: "center" },
  thumb: { width: 64, height: 86, borderRadius: 12 },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  previewTitle: { fontSize: 15, lineHeight: 20 },
  label: { fontSize: 13, marginTop: 6 },
  hint: { fontSize: 12.5, marginTop: -8 },
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  dashed: { borderStyle: "dashed", borderWidth: 1.2 },
  rowLabel: { fontSize: 15 },
  rowDetail: { fontSize: 12.5, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  where: { gap: 8 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10 },
});
