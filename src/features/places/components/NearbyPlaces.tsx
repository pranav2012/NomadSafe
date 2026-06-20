import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import type { NearbyPlace } from "@/features/places/services/nearbyPlaces";

interface UserLocation {
  city?: string;
  latitude?: number;
  longitude?: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; places: NearbyPlace[] }
  | { status: "unavailable"; message: string };

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

function formatDistance(meters: number) {
  if (meters < 1_000) return `${Math.round(meters / 10) * 10} m away`;
  return `${(meters / 1_000).toFixed(1)} km away`;
}

function formatRatingCount(count: number) {
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(".0", "")}k`;
  return `${count}`;
}

export function NearbyPlaces({ userLocation }: { userLocation: UserLocation | null }) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
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
        if (!cancelled) {
          setState({
            status: "unavailable",
            message: error instanceof Error ? error.message : "Nearby places are unavailable",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, retryCount, searchNearby]);

  const placeDistances = useMemo(() => {
    if (latitude == null || longitude == null || state.status !== "ready") return [];
    return state.places.map((place) => ({
      place,
      distance: distanceInMeters({ latitude, longitude }, place),
    }));
  }, [latitude, longitude, state]);

  if (!hasLocation) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: theme.inkMuted }]}>Near you{userLocation?.city ? ` · ${userLocation.city}` : ""}</Text>
          <Text style={[styles.title, { color: theme.inkDeep }]}>Highly rated food & coffee</Text>
        </View>
        <View style={[styles.radius, { backgroundColor: theme.tealSoft }]}>
          <Icon name="mapPin" size={14} color={theme.teal} />
          <Text style={[styles.radiusText, { color: theme.teal }]}>1.5 km</Text>
        </View>
      </View>

      {state.status === "loading" ? (
        <View style={[styles.status, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
          <ActivityIndicator size="small" color={theme.teal} />
          <Text style={[styles.statusText, { color: theme.inkSoft }]}>Finding great places nearby…</Text>
        </View>
      ) : state.status === "unavailable" || placeDistances.length === 0 ? (
        <View style={[styles.status, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}>
          <Icon name="utensils" size={18} color={theme.inkMuted} />
          <View style={styles.statusBody}>
            <Text style={[styles.statusText, { color: theme.inkSoft }]}>
              {state.status === "unavailable" ? state.message : "No highly rated places found nearby."}
            </Text>
            <Pressable
              onPress={() => {
                setState({ status: "loading" });
                setRetryCount((count) => count + 1);
              }}
              style={({ pressed }) => [styles.retry, { backgroundColor: theme.tealSoft, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.retryText, { color: theme.teal }]}>Retry</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
        >
          {placeDistances.map(({ place, distance }) => (
            <Pressable
              key={`${place.name}-${place.latitude}-${place.longitude}`}
              disabled={!place.mapsUrl}
              onPress={() => place.mapsUrl && Linking.openURL(place.mapsUrl)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: theme.paperSoft,
                  borderColor: theme.hairline,
                  opacity: pressed ? 0.74 : 1,
                },
              ]}
            >
              <View style={[styles.iconTile, { backgroundColor: theme.stampSoft }]}>
                <Icon name="utensils" size={24} color={theme.stamp} />
              </View>
              <View style={styles.ratingRow}>
                <Icon name="star" size={13} color={theme.mustard} />
                <Text style={[styles.rating, { color: theme.inkDeep }]}>{place.rating.toFixed(1)}</Text>
                <Text style={[styles.ratingCount, { color: theme.inkMuted }]}>
                  ({formatRatingCount(place.ratingCount)})
                </Text>
              </View>
              <Text style={[styles.placeName, { color: theme.inkDeep }]} numberOfLines={2}>
                {place.name}
              </Text>
              <Text style={[styles.category, { color: theme.inkSoft }]} numberOfLines={1}>
                {place.category}
              </Text>
              <View style={styles.distanceRow}>
                <Icon name="mapPin" size={13} color={theme.inkMuted} />
                <Text style={[styles.distance, { color: theme.inkMuted }]}>{formatDistance(distance)}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  eyebrow: { fontFamily: NOMAD_FONTS.uiSemi, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" },
  title: { fontFamily: NOMAD_FONTS.displayBold, fontSize: 20, marginTop: 3 },
  radius: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  radiusText: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 12 },
  status: { minHeight: 76, borderWidth: 1, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 16 },
  statusBody: { flex: 1, gap: 8 },
  statusText: { fontFamily: NOMAD_FONTS.uiMedium, fontSize: 13, lineHeight: 19 },
  retry: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  retryText: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 12 },
  cards: { gap: 12, paddingRight: 20 },
  card: { width: 188, minHeight: 206, borderWidth: 1, borderRadius: 20, padding: 14, gap: 6 },
  iconTile: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 5 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  rating: { fontFamily: NOMAD_FONTS.uiBold, fontSize: 13 },
  ratingCount: { fontFamily: NOMAD_FONTS.uiMedium, fontSize: 11 },
  placeName: { fontFamily: NOMAD_FONTS.displayBold, fontSize: 17, lineHeight: 21, marginTop: 2 },
  category: { fontFamily: NOMAD_FONTS.uiMedium, fontSize: 12 },
  distanceRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: "auto" },
  distance: { fontFamily: NOMAD_FONTS.uiMedium, fontSize: 12 },
});
