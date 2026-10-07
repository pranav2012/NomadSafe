import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { api, useAction } from "@/modules/backend";
import { withAppCheck } from "@/modules/appCheck";
import { AuraButton, AuraChip, AuraSection, AuraSkeleton, AuraSkeletonGroup, Icon, type IconName, PressableScale, useAura } from "@/atoms";
import { auraSignal } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { isSafeMapsUrl } from "@/utils/safeUrl";
import type { NearbyCategory, NearbyPlace } from "@/features/places/services/nearbyPlaces";
import { areaKey, readPlacesCache, writePlacesCache } from "@/features/places/services/placesCache";
import { isOpenAt } from "@/features/places/utils/openingHours";
import { logger } from "@/modules/logger";

interface UserLocation {
  city?: string;
  latitude?: number;
  longitude?: number;
}

type LoadState = { status: "ready"; places: NearbyPlace[] } | { status: "unavailable" };

const CATEGORIES: { key: NearbyCategory; icon: IconName; tint: string }[] = [
  { key: "food", icon: "utensils", tint: auraSignal.amber },
  { key: "coffee", icon: "coffee", tint: "#C98B5B" },
  { key: "sights", icon: "camera", tint: "#7C8CFF" },
  { key: "essentials", icon: "wallet", tint: auraSignal.ready },
];

const CARD_WIDTH = 236;
const PHOTO_HEIGHT = 136;
const OPEN = auraSignal.ready;
// Straight-line distance undercounts real streets; ~1.3x at 80 m/min is a fair walking estimate.
const WALK_DETOUR = 1.3;
const WALK_METERS_PER_MIN = 80;
const MAX_WALK_MIN = 25;

function distanceInMeters(from: { latitude: number; longitude: number }, place: NearbyPlace) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(place.latitude - from.latitude);
  const longitudeDelta = toRadians(place.longitude - from.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(place.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(value));
}

/** Places around the user by category, as photo cards with walk time, rating and open status. */
export function NearbyPlaces({ userLocation }: { userLocation: UserLocation | null }) {
  const { c, f } = useAura();
  const { t, locale, formatDistance, formatCompactNumber } = useLocalization();
  const latitude = userLocation?.latitude;
  const longitude = userLocation?.longitude;
  const searchNearby = useAction(api.places.searchNearby);
  const [category, setCategory] = useState<NearbyCategory>("food");
  const [results, setResults] = useState<Record<string, LoadState>>({});
  const [brokenPhotos, setBrokenPhotos] = useState<ReadonlySet<string>>(new Set());
  const [now] = useState(Date.now);
  const inflight = useRef(new Set<string>());

  const key = latitude != null && longitude != null ? `nearby:${category}:${areaKey(latitude, longitude)}` : "";
  const cached = useMemo<LoadState | undefined>(() => {
    const places = key ? readPlacesCache<NearbyPlace[]>(key) : undefined;
    return places ? { status: "ready", places } : undefined;
  }, [key]);
  const state = results[key] ?? cached;

  useEffect(() => {
    if (latitude == null || longitude == null || state || inflight.current.has(key)) return;
    inflight.current.add(key);
    withAppCheck({ latitude, longitude, category })
      .then(searchNearby)
      .then((places) => {
        if (places.length) writePlacesCache(key, places);
        setResults((r) => ({ ...r, [key]: { status: "ready", places } }));
      })
      .catch((error) => {
        logger.warn("nearby-places", "failed", error);
        setResults((r) => ({ ...r, [key]: { status: "unavailable" } }));
      })
      .finally(() => inflight.current.delete(key));
  }, [category, key, latitude, longitude, searchNearby, state]);

  const placeDistances = useMemo(() => {
    if (latitude == null || longitude == null || state?.status !== "ready") return [];
    return state.places.map((place) => ({ place, distance: distanceInMeters({ latitude, longitude }, place) }));
  }, [latitude, longitude, state]);

  if (latitude == null || longitude == null) return null;

  const active = CATEGORIES.find((item) => item.key === category)!;
  const ratingFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <View>
      <AuraSection title={userLocation?.city ? t("places.nearYouIn", { city: userLocation.city }) : t("places.nearYou")} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.tabs}>
        {CATEGORIES.map((item) => (
          <AuraChip
            key={item.key}
            icon={item.icon}
            label={t(`places.categories.${item.key}`)}
            selected={item.key === category}
            onPress={() => setCategory(item.key)}
          />
        ))}
      </ScrollView>

      {!state ? (
        <AuraSkeletonGroup label={t("places.loading")}>
          <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.cards}>
            {[0, 1].map((i) => (
              <View key={i} style={[styles.card, { backgroundColor: c.card, borderColor: c.hairline }]}>
                <AuraSkeleton height={PHOTO_HEIGHT} radius={0} />
                <View style={styles.cardBody}>
                  <AuraSkeleton width="70%" height={15} />
                  <AuraSkeleton width="50%" height={11} radius={5.5} />
                  <AuraSkeleton width="35%" height={11} radius={5.5} style={styles.walkRow} />
                </View>
              </View>
            ))}
          </ScrollView>
        </AuraSkeletonGroup>
      ) : state.status === "unavailable" || placeDistances.length === 0 ? (
        <View style={[styles.status, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Icon name={active.icon} size={18} color={c.textMuted} />
          <Text style={[styles.statusText, { color: c.textSoft, fontFamily: f.regular }]}>
            {state.status === "unavailable" ? t("places.unavailable") : t("places.nothingNearby")}
          </Text>
          <AuraButton
            label={t("places.retry")}
            variant="secondary"
            size="md"
            onPress={() =>
              setResults((r) => {
                const { [key]: _stale, ...rest } = r;
                return rest;
              })
            }
          />
        </View>
      ) : (
        <ScrollView
          key={category}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
          style={styles.bleed}
          snapToInterval={CARD_WIDTH + 12}
          decelerationRate="fast"
        >
          {placeDistances.map(({ place, distance }) => {
            const photo = place.photoUrl && !brokenPhotos.has(place.photoUrl) ? place.photoUrl : null;
            const open = place.hours ? isOpenAt(place.hours, now) : place.openNow;
            const walkMin = Math.max(1, Math.round((distance * WALK_DETOUR) / WALK_METERS_PER_MIN));
            const away = walkMin <= MAX_WALK_MIN ? t("places.walk", { count: walkMin }) : formatDistance(distance / 1_000);
            return (
              <PressableScale
                key={`${place.name}-${place.latitude}-${place.longitude}`}
                disabled={!isSafeMapsUrl(place.mapsUrl)}
                onPress={() => {
                  if (isSafeMapsUrl(place.mapsUrl)) void Linking.openURL(place.mapsUrl).catch(() => {});
                }}
                pressedScale={0.97}
                accessibilityRole="link"
                accessibilityLabel={`${place.name}, ${place.category}, ${away}`}
                style={[styles.card, { backgroundColor: c.card, borderColor: c.hairline }]}
              >
                <View style={[styles.photo, { backgroundColor: `${active.tint}22` }]}>
                  {photo ? (
                    <Image
                      source={{ uri: photo }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={220}
                      recyclingKey={photo}
                      onError={() => setBrokenPhotos((set) => new Set(set).add(photo))}
                    />
                  ) : (
                    <Icon name={active.icon} size={34} color={active.tint} />
                  )}
                  {photo ? <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]} style={styles.photoFade} /> : null}
                  {open != null ? (
                    <View style={styles.openPill}>
                      <View style={[styles.openDot, { backgroundColor: open ? OPEN : "#FF6B6B" }]} />
                      <Text style={[styles.openText, { fontFamily: f.semibold }]}>{open ? t("places.openNow") : t("places.closed")}</Text>
                    </View>
                  ) : null}
                  {photo && place.photoAuthor ? (
                    <Text numberOfLines={1} style={[styles.credit, { fontFamily: f.regular }]}>
                      {t("places.photoBy", { name: place.photoAuthor })}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.cardBody}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.placeName, { color: c.text, fontFamily: f.semibold }]} numberOfLines={1}>
                      {place.name}
                    </Text>
                    {place.rating !== null ? (
                      <View style={styles.ratingRow}>
                        <Icon name="star" size={12} color={auraSignal.amber} />
                        <Text style={[styles.rating, { color: c.text, fontFamily: f.semibold }]}>{ratingFormat.format(place.rating)}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.category, { color: c.textSoft, fontFamily: f.regular }]} numberOfLines={1}>
                    {place.category}
                    {place.ratingCount > 0 ? ` · ${formatCompactNumber(place.ratingCount)} ★` : ""}
                  </Text>
                  <View style={styles.walkRow}>
                    <Icon name="mapPin" size={12} color={active.tint} />
                    <Text style={[styles.walk, { color: c.text, fontFamily: f.medium }]}>{away}</Text>
                  </View>
                </View>
              </PressableScale>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -20 },
  tabs: { paddingHorizontal: 20, gap: 8, paddingBottom: 14 },
  status: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  statusText: { flex: 1, fontSize: 14, lineHeight: 20 },
  cards: { paddingHorizontal: 20, gap: 12 },
  card: { width: CARD_WIDTH, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  photo: { height: PHOTO_HEIGHT, alignItems: "center", justifyContent: "center" },
  photoFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 56 },
  openPill: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: "rgba(10,12,18,0.62)",
  },
  openDot: { width: 6, height: 6, borderRadius: 3 },
  openText: { fontSize: 11.5, color: "#FFFFFF" },
  credit: { position: "absolute", right: 10, bottom: 7, maxWidth: CARD_WIDTH - 20, fontSize: 9.5, color: "rgba(255,255,255,0.8)" },
  cardBody: { padding: 13, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  placeName: { flex: 1, fontSize: 15.5, lineHeight: 20 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  rating: { fontSize: 13 },
  category: { fontSize: 12.5 },
  walkRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  walk: { fontSize: 12.5 },
});
