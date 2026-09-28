import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import * as Location from "expo-location";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "@/components/nomad/Icon";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useAuthStore } from "@/features/auth";
import {
  getDestinationCoordinates,
  hasTripBudget,
  type LatLng,
  selectActiveTrip,
  type Trip,
  useTripsStore,
} from "@/features/trips/store/tripsStore";
import { TripForm } from "@/features/trips/components/TripForm";
import { TripWeather } from "@/features/trips/components/TripWeather";
import {
  countInclusiveDays,
  fromDateKey,
  getTripStatus,
  startOfLocalDay,
} from "@/features/trips/utils/dates";
import {
  isCompactFrame,
  regionForPoints,
  tripFramePoints,
} from "@/features/trips/utils/mapFraming";
import { TripItinerary, useItineraryAutoSync } from "@/features/itinerary";
import { NearbyPlaces } from "@/features/places/components/NearbyPlaces";
import { useSharingStore } from "@/features/location-sharing";
import { useTheme } from "@/hooks/useTheme";
import { useLocalization } from "@/localization";
import { useTripExpenseSummary } from "@/features/expenses/hooks/useTripExpenseSummary";
import { formatMoney } from "@/features/expenses/utils/money";
import { PostHogMaskView } from "posthog-react-native";

interface UserLocation {
  city?: string;
  country?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
}

function getTripProgress(trip: Trip) {
  const today = startOfLocalDay(new Date());
  const startDate = fromDateKey(trip.startDate);
  const endDate = fromDateKey(trip.endDate);
  const totalDays = countInclusiveDays(startDate, endDate);
  const status = getTripStatus(trip);

  if (status === "upcoming") return { status, day: 0, totalDays, percent: 0 };
  if (status === "complete") return { status, day: totalDays, totalDays, percent: 100 };

  const elapsedDays = countInclusiveDays(startDate, today);
  return {
    status,
    day: Math.min(elapsedDays, totalDays),
    totalDays,
    percent: Math.min(100, (elapsedDays / totalDays) * 100),
  };
}

function greetingKeyFor(hour: number) {
  if (hour >= 5 && hour < 12) return "trip.goodMorning";
  if (hour >= 12 && hour < 17) return "trip.goodAfternoon";
  return "trip.goodEvening";
}

/**
 * Best-effort device position: current fix, else last known. Reverse geocoding
 * only adds a city label, so its failure never discards the coordinates.
 */
async function resolveUserLocation(): Promise<UserLocation | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) return null;
  } catch {
    return null;
  }

  let coords: { latitude: number; longitude: number } | null = null;
  try {
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    coords = current.coords;
  } catch {
    // Android throws when location services are off; try the cached fix.
  }
  if (!coords) {
    try {
      const lastKnown = await Location.getLastKnownPositionAsync();
      coords = lastKnown?.coords ?? null;
    } catch {
      coords = null;
    }
  }
  if (!coords) return null;

  const location: UserLocation = { latitude: coords.latitude, longitude: coords.longitude };
  try {
    const [reverse] = await Location.reverseGeocodeAsync({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    if (reverse) {
      location.city = reverse.city ?? reverse.subregion ?? undefined;
      location.country = reverse.country ?? undefined;
      location.region = reverse.region ?? undefined;
    }
  } catch {
    // City label is optional.
  }
  return location;
}

export default function HomeScreen() {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t, locale, formatCurrency, formatDate } = useLocalization();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const tripCount = useTripsStore((state) => state.trips.length);
  const activeTrip = useTripsStore(selectActiveTrip);
  useItineraryAutoSync(activeTrip);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);

  useEffect(() => {
    let isMounted = true;
    resolveUserLocation().then((location) => {
      if (isMounted && location) setUserLocation(location);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  if (!activeTrip) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={[styles.root, { backgroundColor: theme.paper }]}
      >
        <TripForm
          onSave={() => undefined}
          header={
            tripCount > 0 ? (
              <Pressable
                onPress={() => router.push("/trips")}
                style={({ pressed }) => [
                  styles.switchPill,
                  styles.existingTripsLink,
                  { backgroundColor: theme.tealSoft, opacity: pressed ? 0.75 : 1 },
                ]}
              >
                <Icon name="swap" size={12} color={theme.teal} />
                <Text style={[styles.switchPillText, { color: theme.teal }]}>
                  {t("trip.viewExistingTrips", { count: tripCount })}
                </Text>
              </Pressable>
            ) : null
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.root, { backgroundColor: theme.paper }]}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TripDashboard
          trip={activeTrip}
          user={user}
          userLocation={userLocation}
          locale={locale}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function TripDashboard({
  trip,
  user,
  userLocation,
  locale,
  formatCurrency,
  formatDate,
}: {
  trip: Trip;
  user: ReturnType<typeof useAuthStore.getState>["user"];
  userLocation: UserLocation | null;
  locale: string;
  formatCurrency: ReturnType<typeof useLocalization>["formatCurrency"];
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
}) {
  const { nomad } = useTheme();
  const theme = nomad.colors;
  const { t } = useLocalization();
  const router = useRouter();
  const startDate = useMemo(() => fromDateKey(trip.startDate), [trip.startDate]);
  const endDate = useMemo(() => fromDateKey(trip.endDate), [trip.endDate]);
  const duration = countInclusiveDays(startDate, endDate);
  const progress = getTripProgress(trip);
  const expenseSummary = useTripExpenseSummary(trip);
  const companionCount = trip.mode === "group" ? trip.companions.length : 0;
  const isSharingLocation = useSharingStore((state) => state.isBroadcasting);

  const statusColors = isSharingLocation
    ? { bg: theme.mustardSoft, fg: theme.mustard }
    : { bg: theme.tealSoft, fg: theme.teal };

  const today = new Date();
  const greetingKey = greetingKeyFor(today.getHours());

  const dayFormatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const fullDateFormatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const hasBudget = hasTripBudget(trip);
  const budgetRemaining = Math.max(0, trip.budget - expenseSummary.total);

  // Trips have no per-destination dates, so GPS is the only honest "where am I".
  const currentLocation = userLocation?.city
    ? [userLocation.city, userLocation.country].filter(Boolean).join(", ")
    : null;
  const destinationsLabel = trip.destinations.join(" · ") || "—";

  const userName = user?.name?.split(" ")[0] ?? t("common.fallbackUser");

  return (
    <View style={styles.stack}>
      <View style={styles.greetingHeader}>
        <View style={styles.greetingTop}>
          <View>
            <Text style={[styles.greetingEyebrow, { color: theme.inkMuted }]}>
              {fullDateFormatter.format(today)} · {t("trip.dayProgress", { day: progress.day, total: duration })}
            </Text>
            <Text style={[styles.greetingTitle, { color: theme.inkDeep }]}>
              {t(greetingKey)},
            </Text>
            <Text style={[styles.greetingTitle, { color: theme.inkDeep }]}>
              <Text style={[styles.greetingTitleAccent, { color: theme.inkDeep }]}>
                {userName}
              </Text>
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/settings")}
            style={({ pressed }) => [styles.avatarButton, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: theme.mustard,
                  borderColor: theme.paperSoft,
                },
              ]}
            >
              <Text style={[styles.avatarText, { color: theme.inverse }]}>
                {userName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View
              style={[
                styles.avatarBadge,
                { backgroundColor: theme.teal, borderColor: theme.paper },
              ]}
            />
          </Pressable>
        </View>

        <View style={styles.progressBarSection}>
          <View style={[styles.progressBarTrack, { backgroundColor: theme.hairline }]}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${progress.percent}%`,
                  backgroundColor: theme.teal,
                },
              ]}
            />
            <View
              style={[
                styles.progressBarThumb,
                {
                  start: `${progress.percent}%`,
                  borderColor: theme.mustard,
                  backgroundColor: theme.inverse,
                },
              ]}
            />
          </View>
          <View style={styles.progressBarLabels}>
            <Text style={[styles.progressBarLabel, { color: theme.inkMuted }]}>
              {dayFormatter.format(startDate)} · {t("trip.start")}
            </Text>
            <Text style={[styles.progressBarLabelActive, { color: theme.mustard }]}>
              {progress.status === "upcoming"
                ? t("trip.startsIn", { count: Math.max(1, countInclusiveDays(today, startDate) - 1) })
                : progress.status === "complete"
                  ? t("trip.completed")
                  : [t("trip.dayProgress", { day: progress.day, total: duration }), currentLocation]
                      .filter(Boolean)
                      .join(" · ")}
            </Text>
            <Text style={[styles.progressBarLabel, { color: theme.inkMuted }]}>
              {dayFormatter.format(endDate)} · {t("trip.end")}
            </Text>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.homeTripCard,
          { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
        ]}
      >
        <View style={styles.homeTripHeader}>
          <View style={styles.homeTripHeaderLeft}>
            <Text style={[styles.homeTripLabel, { color: theme.inkMuted }]}>
              {t("trip.currentTrip")}
            </Text>
            <Pressable
              onPress={() => router.push("/trips")}
              style={({ pressed }) => [
                styles.switchPill,
                { backgroundColor: theme.tealSoft, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <Icon name="swap" size={10} color={theme.teal} />
              <Text style={[styles.switchPillText, { color: theme.teal }]}>
                {t("trip.switch")}
              </Text>
            </Pressable>
          </View>
          <View
            style={[styles.homeTripStatusPill, { backgroundColor: statusColors.bg }]}
          >
            <View style={[styles.homeTripStatusDot, { backgroundColor: statusColors.fg }]} />
            <Text style={[styles.homeTripStatusText, { color: statusColors.fg }]}>
              {isSharingLocation ? t("trip.sharingLive") : t("trip.notSharing")}
            </Text>
          </View>
        </View>

        <Text style={[styles.homeTripName, { color: theme.inkDeep }]}>
          {trip.name}
        </Text>
        <Text style={[styles.homeTripSub, { color: theme.inkSoft }]}>
          {formatDate(startDate)} — {formatDate(endDate)} ·{" "}
          {trip.mode === "solo" ? t("trip.solo") : t("trip.groupWithCount", { count: companionCount + 1 })} ·{" "}
          {t("trip.destinationsCount", { count: trip.destinations.length })}
        </Text>

        <View style={[styles.mapPlaceholder, { backgroundColor: theme.paper }]}>
          <TripMap trip={trip} userLocation={userLocation} theme={theme} t={t} />
        </View>

        <View style={styles.homeTripMetrics}>
          <View style={[styles.homeTripMetric, { backgroundColor: theme.paper }]}>
            <Text style={[styles.homeTripMetricLabel, { color: theme.inkMuted }]}>
              {progress.status === "upcoming" ? t("trip.starts") : progress.status === "complete" ? t("trip.ended") : t("trip.destination")}
            </Text>
            <Text style={[styles.homeTripMetricValue, { color: theme.inkDeep }]} numberOfLines={1}>
              {progress.status === "upcoming" ? formatDate(startDate) : progress.status === "complete" ? formatDate(endDate) : destinationsLabel}
            </Text>
            <Text style={[styles.homeTripMetricSub, { color: theme.inkSoft }]}>
              {progress.status === "upcoming"
                ? t("trip.inDays", { count: Math.max(1, countInclusiveDays(today, startDate) - 1) })
                : progress.status === "complete"
                  ? t("trip.daysAgo", { count: Math.max(1, countInclusiveDays(endDate, today) - 1) })
                  : t("trip.daysLeft", { count: Math.max(0, duration - progress.day + 1) })}
            </Text>
          </View>
          <View style={[styles.homeTripMetric, { backgroundColor: theme.paper }]}>
            <Text style={[styles.homeTripMetricLabel, { color: theme.inkMuted }]}>
              {hasBudget ? t("trip.remaining") : t("trip.spent")}
            </Text>
            <Text style={[styles.homeTripMetricValue, { color: theme.inkDeep }]}>
              {formatMoney(formatCurrency, hasBudget ? budgetRemaining : expenseSummary.total, trip.currency)}
            </Text>
            <Text style={[styles.homeTripMetricSub, { color: theme.inkSoft }]}>
              {hasBudget
                ? t("trip.ofBudget", { total: formatMoney(formatCurrency, trip.budget, trip.currency) })
                : t("trip.noBudgetSet")}
            </Text>
          </View>
        </View>
      </View>

      <TripWeather trip={trip} userLocation={userLocation} />

      <TripItinerary trip={trip} />

      <NearbyPlaces userLocation={userLocation} />
    </View>
  );
}

// Pins hang above their coordinate, so the top needs the most room.
const MAP_EDGE_PADDING = { top: 52, right: 36, bottom: 24, left: 36 };

function TripMap({
  trip,
  userLocation,
  theme,
  t,
}: {
  trip: Trip;
  userLocation: { latitude?: number; longitude?: number } | null;
  theme: ReturnType<typeof useTheme>["nomad"]["colors"];
  t: ReturnType<typeof useLocalization>["t"];
}) {
  const mapRef = useRef<MapView>(null);
  // Keep each pin paired with its destination name; unresolved ones are skipped.
  const pins = useMemo(
    () =>
      getDestinationCoordinates(trip).flatMap((coord, index) =>
        coord ? [{ coord, name: trip.destinations[index] }] : [],
      ),
    [trip],
  );
  const destinations = useMemo(() => pins.map((pin) => pin.coord), [pins]);
  const userCoords = useMemo((): LatLng | null => {
    const lat = userLocation?.latitude;
    const lon = userLocation?.longitude;
    if (lat != null && lon != null) {
      return { latitude: lat, longitude: lon };
    }
    return null;
  }, [userLocation?.latitude, userLocation?.longitude]);
  // The user only joins the frame when near a destination, so a far-away home doesn't zoom out to an ocean.
  const framePoints = useMemo(
    () => tripFramePoints(destinations, userCoords),
    [destinations, userCoords],
  );
  const hasAnyCoords = framePoints.length > 0;

  const destinationRoutePath = useMemo((): LatLng[] => {
    const points = framePoints;
    if (points.length < 2) return points;

    const result: LatLng[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      result.push(start);
      const mid = {
        latitude: (start.latitude + end.latitude) / 2 + (end.longitude - start.longitude) * 0.12,
        longitude: (start.longitude + end.longitude) / 2 - (start.latitude - end.latitude) * 0.12,
      };
      const steps = 16;
      for (let s = 1; s < steps; s += 1) {
        const t1 = s / steps;
        const t2 = 1 - t1;
        result.push({
          latitude: t2 * t2 * start.latitude + 2 * t2 * t1 * mid.latitude + t1 * t1 * end.latitude,
          longitude: t2 * t2 * start.longitude + 2 * t2 * t1 * mid.longitude + t1 * t1 * end.longitude,
        });
      }
    }
    result.push(points[points.length - 1]);
    return result;
  }, [framePoints]);

  const initialRegion = useMemo((): Region => regionForPoints(framePoints), [framePoints]);

  const fitMap = useCallback(() => {
    if (!mapRef.current || framePoints.length === 0) return;

    // A lone pin or a tight cluster would max-zoom with fitToCoordinates; hold city level instead.
    if (framePoints.length === 1 || isCompactFrame(framePoints)) {
      mapRef.current.animateToRegion(regionForPoints(framePoints), 400);
      return;
    }

    // Fit raw markers (not the curved polyline) so Android includes every pin.
    mapRef.current.fitToCoordinates(framePoints, {
      edgePadding: MAP_EDGE_PADDING,
      animated: true,
    });
  }, [framePoints]);

  useEffect(() => {
    const timer = setTimeout(fitMap, Platform.OS === "android" ? 600 : 300);
    return () => clearTimeout(timer);
  }, [fitMap]);

  useEffect(() => {
    // Android sometimes ignores the first fit while the map is still laying out; retry once.
    if (Platform.OS !== "android") return;
    const timer = setTimeout(fitMap, 900);
    return () => clearTimeout(timer);
  }, [fitMap]);

  if (!hasAnyCoords) {
    return (
      <View style={styles.mapFallback}>
        <Icon name="globe" size={34} color={theme.inkMuted} />
        <Text style={[styles.mapFallbackText, { color: theme.inkMuted }]}>
          {t("trip.mapNoCoordinates")}
        </Text>
      </View>
    );
  }

  return (
    <PostHogMaskView style={styles.map}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        onLayout={fitMap}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        mapType="standard"
        // On Android, tapping a marker centers it by default and can push far-away
        // destinations off-screen. Since map interactions are already disabled,
        // ignoring marker selections keeps the original fitted view intact.
        onMarkerSelect={() => {
          if (Platform.OS === "android") {
            // Returning nothing/undefined keeps native default behavior. Instead,
            // we re-fit after a short delay so every destination stays visible.
            setTimeout(() => fitMap(), 150);
          }
        }}
      >
        {destinationRoutePath.length > 1 ? (
          <Polyline
            coordinates={destinationRoutePath}
            strokeColor={theme.inkSoft}
            strokeWidth={2.5}
            lineDashPattern={[6, 6]}
            zIndex={1}
          />
        ) : null}
        {userCoords ? (
          <Marker
            coordinate={userCoords}
            title={t("trip.currentLocation")}
            pinColor={theme.teal}
          />
        ) : null}
        {pins.map((pin, index) => (
          <Marker
            key={`${trip.id}-dest-${index}`}
            coordinate={pin.coord}
            title={pin.name ?? t("trip.destination")}
            pinColor={theme.stamp}
          />
        ))}
      </MapView>
    </PostHogMaskView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 120,
  },
  stack: {
    gap: 16,
  },
  greetingHeader: {
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 16,
  },
  greetingTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  greetingEyebrow: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  greetingTitle: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.7,
    marginTop: 6,
  },
  greetingTitleAccent: {
    fontStyle: "italic",
  },
  avatarButton: {
    position: "relative",
    borderRadius: 999,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 16,
  },
  avatarBadge: {
    position: "absolute",
    top: -2,
    end: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  progressBarSection: {
    gap: 8,
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 999,
    position: "relative",
    overflow: "hidden",
  },
  progressBarFill: {
    position: "absolute",
    start: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
  },
  progressBarThumb: {
    position: "absolute",
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    marginStart: -8,
  },
  progressBarLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressBarLabel: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  progressBarLabelActive: {
    fontFamily: NOMAD_FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.3,
    fontWeight: "700",
  },
  homeTripCard: {
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
    padding: 16,
    gap: 10,
  },
  homeTripHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 2,
  },
  homeTripHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  homeTripLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  switchPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  existingTripsLink: {
    alignSelf: "flex-start",
    marginStart: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  switchPillText: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9,
    letterSpacing: 0.4,
  },
  homeTripStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  homeTripStatusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  homeTripStatusText: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 10.5,
    letterSpacing: 0.3,
  },
  homeTripName: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.4,
    marginTop: 2,
  },
  homeTripSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  mapPlaceholder: {
    height: 200,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    position: "relative",
    overflow: "hidden",
  },
  map: {
    width: "100%",
    height: "100%",
  },
  mapFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  mapFallbackText: {
    fontFamily: NOMAD_FONTS.uiMedium,
    fontSize: 13,
    textAlign: "center",
  },
  homeTripMetrics: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  homeTripMetric: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  homeTripMetricLabel: {
    fontFamily: NOMAD_FONTS.uiBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  homeTripMetricValue: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: -0.3,
  },
  homeTripMetricSub: {
    fontFamily: NOMAD_FONTS.ui,
    fontSize: 10,
    lineHeight: 14,
  },
});
