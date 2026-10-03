import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { Icon } from "@/components/nomad/Icon";
import { useAura } from "@/components/aura/useAura";
import { AuraSection } from "@/components/aura/AuraSection";
import { AuraButton } from "@/components/aura/AuraButton";
import { PressableScale } from "@/components/motion/PressableScale";
import { useLocalization } from "@/localization";
import type { NearbyPlace } from "@/features/places/services/nearbyPlaces";
import { logger } from "@/services/logger";

interface UserLocation {
  city?: string;
  latitude?: number;
  longitude?: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; places: NearbyPlace[] }
  | { status: "unavailable" };

function distanceInMeters(
  from: Required<Pick<UserLocation, "latitude" | "longitude">>,
  place: NearbyPlace,
) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(place.latitude - from.latitude);
  const longitudeDelta = toRadians(place.longitude - from.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(place.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(value));
}

const SEARCH_RADIUS_KM = 1.5;

function formatDistance(meters: number, locale: string) {
  const inKm = meters >= 1_000;
  try {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: inKm ? "kilometer" : "meter",
      unitDisplay: "short",
      maximumFractionDigits: inKm ? 1 : 0,
    }).format(inKm ? meters / 1_000 : Math.round(meters / 10) * 10);
  } catch {
    return inKm ? `${(meters / 1_000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;
  }
}

function formatRatingCount(count: number, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(count);
  } catch {
    return `${count}`;
  }
}

export function NearbyPlaces({ userLocation }: { userLocation: UserLocation | null }) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const latitude = userLocation?.latitude;
  const longitude = userLocation?.longitude;
  const hasLocation = latitude != null && longitude != null;
  const searchNearby = useAction(api.places.searchNearby);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (latitude == null || longitude == null) return;
    let cancelled = false;
    searchNearby({ latitude, longitude })
      .then((places) => {
        if (!cancelled) setState({ status: "ready", places });
      })
      .catch((error) => {
        logger.warn("nearby-places", "failed", error);
        if (!cancelled) setState({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, retryCount, searchNearby]);

  const placeDistances = useMemo(() => {
    if (latitude == null || longitude == null || state.status !== "ready") return [];
    return state.places.map((place) => ({ place, distance: distanceInMeters({ latitude, longitude }, place) }));
  }, [latitude, longitude, state]);

  if (!hasLocation) return null;

  return (
    <View>
      <AuraSection
        title={userLocation?.city ? t("places.nearYouIn", { city: userLocation.city }) : t("places.title")}
        action={
          <View style={[styles.radius, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="mapPin" size={13} color={c.textSoft} />
            <Text style={[styles.radiusText, { color: c.textSoft, fontFamily: f.medium }]}>{formatDistance(SEARCH_RADIUS_KM * 1_000, locale)}</Text>
          </View>
        }
      />

      {state.status === "loading" ? (
        <View style={[styles.status, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <ActivityIndicator size="small" color={c.textSoft} />
          <Text style={[styles.statusText, { color: c.textSoft, fontFamily: f.regular }]}>{t("places.loading")}</Text>
        </View>
      ) : state.status === "unavailable" || placeDistances.length === 0 ? (
        <View style={[styles.status, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Icon name="utensils" size={18} color={c.textMuted} />
          <Text style={[styles.statusText, { color: c.textSoft, fontFamily: f.regular }]}>
            {state.status === "unavailable" ? t("places.unavailable") : t("places.empty")}
          </Text>
          <AuraButton
            label={t("places.retry")}
            variant="secondary"
            size="md"
            onPress={() => {
              setState({ status: "loading" });
              setRetryCount((count) => count + 1);
            }}
          />
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards} style={styles.bleed} snapToInterval={CARD_WIDTH + 12} decelerationRate="fast">
          {placeDistances.map(({ place, distance }) => (
            <PressableScale
              key={`${place.name}-${place.latitude}-${place.longitude}`}
              disabled={!place.mapsUrl}
              onPress={() => {
                if (place.mapsUrl) void Linking.openURL(place.mapsUrl);
              }}
              pressedScale={0.97}
              style={[styles.card, { backgroundColor: c.card, borderColor: c.hairline }]}
            >
              <View style={[styles.cardHighlight, { backgroundColor: c.highlight }]} />
              <View style={styles.cardTop}>
                <View style={[styles.iconTile, { backgroundColor: `${WARM}22` }]}>
                  <Icon name="utensils" size={18} color={WARM} />
                </View>
                <View style={styles.ratingRow}>
                  <Icon name="star" size={12} color={WARM} />
                  <Text style={[styles.rating, { color: c.text, fontFamily: f.semibold }]}>
                    {new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(place.rating)}
                  </Text>
                  <Text style={[styles.ratingCount, { color: c.textMuted, fontFamily: f.regular }]}>({formatRatingCount(place.ratingCount, locale)})</Text>
                </View>
              </View>
              <Text style={[styles.placeName, { color: c.text, fontFamily: f.semibold }]} numberOfLines={2}>
                {place.name}
              </Text>
              <Text style={[styles.category, { color: c.textSoft, fontFamily: f.regular }]} numberOfLines={1}>
                {place.category} · {formatDistance(distance, locale)}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const CARD_WIDTH = 196;
const WARM = "#FFB547";

const styles = StyleSheet.create({
  radius: { flexDirection: "row", alignItems: "center", gap: 5, height: 30, paddingHorizontal: 11, borderRadius: 15 },
  radiusText: { fontSize: 12.5 },
  status: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  statusText: { flex: 1, fontSize: 14, lineHeight: 20 },
  bleed: { marginHorizontal: -20 },
  cards: { paddingHorizontal: 20, gap: 12 },
  card: { width: CARD_WIDTH, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 6, overflow: "hidden" },
  cardHighlight: { position: "absolute", top: 0, left: 22, right: 22, height: StyleSheet.hairlineWidth },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  iconTile: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  rating: { fontSize: 13 },
  ratingCount: { fontSize: 12 },
  placeName: { fontSize: 15, lineHeight: 20 },
  category: { fontSize: 12.5 },
});
