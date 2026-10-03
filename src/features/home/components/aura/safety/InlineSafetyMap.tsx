import React, { useMemo, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { auraFonts as f, type AuraPalette } from "@/constants/aura";
import type { HomeStop } from "@/features/home/types";
import type { PlacePin, SafetyPlace } from "@/features/home/hooks/useTripSafety";
import { formatDistance } from "@/features/home/utils/format";
import { isCompactFrame, regionForPoints } from "@/features/trips/utils/mapFraming";
import { useLocalization } from "@/localization";
import { distanceKm } from "../globe/sun";
import { quietMapStyle } from "../mapStyles";
import { SAFETY_KIND_META } from "./kinds";

/** Web-Mercator zoom (256 dp world at zoom 0) whose equator spans 2πR dp, matching a globe of radius R. */
function zoomForGlobeRadius(radiusPx: number) {
  return Math.log2((2 * Math.PI * radiusPx) / 256);
}

/** Apple Maps takes camera altitude, not zoom: the height that shows the same span on screen. */
function altitudeForZoom(zoom: number, latitude: number, viewHeight: number) {
  const metresPerPoint = (156_543.03 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  return (metresPerPoint * viewHeight) / (2 * Math.tan((15 * Math.PI) / 180));
}

/** Wider than this many degrees of longitude and the user has zoomed back out to globe scale. */
const BACK_TO_GLOBE_SPAN = 40;
const EDGE_PADDING = { top: 70, right: 50, bottom: 70, left: 50 };

/** Gently curved line through the stops (quadratic bend per leg), as on the old trip map. */
function routePath(points: { latitude: number; longitude: number }[]) {
  if (points.length < 2) return points;
  const path: { latitude: number; longitude: number }[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const mid = {
      latitude: (a.latitude + b.latitude) / 2 + (b.longitude - a.longitude) * 0.12,
      longitude: (a.longitude + b.longitude) / 2 - (a.latitude - b.latitude) * 0.12,
    };
    for (let s = 0; s < 16; s += 1) {
      const t = s / 16;
      const u = 1 - t;
      path.push({
        latitude: u * u * a.latitude + 2 * u * t * mid.latitude + t * t * b.latitude,
        longitude: u * u * a.longitude + 2 * u * t * mid.longitude + t * t * b.longitude,
      });
    }
  }
  path.push(points[points.length - 1]);
  return path;
}

interface InlineSafetyMapProps {
  height: number;
  /** Where the globe hand-off happened and how big the globe was, so the map starts matching it. */
  from: { center: { latitude: number; longitude: number }; radiusPx: number };
  stop: HomeStop | undefined;
  /** Every stop of the trip; the map opens framed on all of them with the route drawn. */
  stops: HomeStop[];
  hotel: PlacePin | null;
  places: SafetyPlace[] | null;
  contacts: PlacePin[];
  palette: AuraPalette;
  accent: string;
  isDark: boolean;
  onBackToGlobe: (center: { latitude: number; longitude: number }) => void;
  onTouchActive: (active: boolean) => void;
}

/**
 * The real map the globe zooms into, in the same space. It starts at the globe's scale and glides
 * to frame the whole trip route. Safety places around the current stop are pins; tapping one shows
 * a card with call and directions. Zooming back out past the trip returns to the globe.
 */
export function InlineSafetyMap({
  height,
  from,
  stop,
  stops,
  hotel,
  places,
  contacts,
  palette: c,
  accent,
  isDark,
  onBackToGlobe,
  onTouchActive,
}: InlineSafetyMapProps) {
  const { t, locale } = useLocalization();
  const mapRef = useRef<MapView>(null);
  const [selected, setSelected] = useState<SafetyPlace | null>(null);
  const [settled, setSettled] = useState(false);
  const style = useMemo(() => quietMapStyle(isDark), [isDark]);

  const startZoom = Math.max(2, zoomForGlobeRadius(from.radiusPx));
  const startCamera = {
    center: from.center,
    zoom: startZoom,
    altitude: altitudeForZoom(startZoom, from.center.latitude, height),
    pitch: 0,
    heading: 0,
  };

  const route = useMemo(() => routePath(stops), [stops]);
  // A trip wider than the default threshold would bounce straight back to the globe.
  const backSpan = Math.max(BACK_TO_GLOBE_SPAN, regionForPoints(stops).longitudeDelta * 2.5);

  const glideIn = () => {
    const map = mapRef.current;
    if (!map) return;
    if (stops.length > 1 && !isCompactFrame(stops)) {
      map.fitToCoordinates(stops, { edgePadding: EDGE_PADDING, animated: true });
    } else {
      // A lone stop or tight cluster would max-zoom with fitToCoordinates; hold city level instead.
      map.animateToRegion(regionForPoints(stops.length ? stops : stop ? [stop] : [from.center]), 900);
    }
    setTimeout(() => setSettled(true), 1200);
  };

  const onRegionChangeComplete = (region: Region) => {
    if (settled && region.longitudeDelta > backSpan) {
      onBackToGlobe({ latitude: region.latitude, longitude: region.longitude });
    }
  };

  const sorted = useMemo(
    () => (stop && places ? places.map((place) => ({ place, km: distanceKm(stop, place) })).sort((a, b) => a.km - b.km).slice(0, 15) : []),
    [places, stop],
  );
  const selectedKm = selected && stop ? distanceKm(stop, selected) : null;

  return (
    <View
      style={{ height }}
      onTouchStart={() => onTouchActive(true)}
      onTouchEnd={() => onTouchActive(false)}
      onTouchCancel={() => onTouchActive(false)}
    >
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialCamera={startCamera}
        customMapStyle={style}
        userInterfaceStyle={isDark ? "dark" : "light"}
        onMapReady={glideIn}
        onRegionChangeComplete={onRegionChangeComplete}
        onPress={() => setSelected(null)}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        moveOnMarkerPress={false}
      >
        {route.length > 1 ? (
          <Polyline coordinates={route} strokeColor={accent} strokeWidth={2.5} lineDashPattern={[6, 6]} zIndex={1} />
        ) : null}
        {stops.map((s, i) =>
          stop && s.latitude === stop.latitude && s.longitude === stop.longitude ? null : (
            <Marker key={`stop-${i}`} coordinate={s} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={[styles.otherStop, { borderColor: accent, backgroundColor: c.surfaceStrong }]} />
            </Marker>
          ),
        )}
        {stop ? (
          <Marker coordinate={stop} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[styles.stopHalo, { backgroundColor: `${accent}33` }]}>
              <View style={[styles.stopDot, { backgroundColor: accent }]} />
            </View>
          </Marker>
        ) : null}
        {hotel ? (
          <Marker coordinate={hotel} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[styles.pin, { backgroundColor: c.inverse }]}>
              <Icon name="building" size={15} color={c.onInverse} />
            </View>
          </Marker>
        ) : null}
        {sorted.map(({ place }, i) => {
          const meta = SAFETY_KIND_META[place.kind];
          return (
            <Marker
              key={`${place.name}-${i}`}
              coordinate={place}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={(event) => {
                event.stopPropagation();
                setSelected(place);
              }}
            >
              <View style={[styles.pin, { backgroundColor: meta.color }]}>
                <Icon name={meta.icon} size={14} color="#FFFFFF" strokeWidth={2.2} />
              </View>
            </Marker>
          );
        })}
        {contacts.map((contact, i) => (
          <Marker key={`contact-${i}`} coordinate={contact} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.contact}>
              <Text style={styles.contactInitial}>{contact.name.charAt(0).toUpperCase()}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      <PressableScale
        onPress={() => onBackToGlobe(from.center)}
        accessibilityRole="button"
        accessibilityLabel={t("home.backToGlobe")}
        style={[styles.globeButton, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
      >
        <Icon name="globe" size={18} color={c.text} />
      </PressableScale>

      {selected ? (
        <Animated.View
          key={`${selected.name}-${selected.latitude}`}
          entering={FadeInDown.duration(220)}
          exiting={FadeOutDown.duration(160)}
          style={[styles.card, { backgroundColor: c.card, borderColor: c.hairline }]}
        >
          <View style={styles.cardTop}>
            <View style={[styles.kindDot, { backgroundColor: SAFETY_KIND_META[selected.kind].color }]}>
              <Icon name={SAFETY_KIND_META[selected.kind].icon} size={12} color="#FFFFFF" strokeWidth={2.4} />
            </View>
            <Text style={[styles.kind, { color: c.textSoft }]}>{t(SAFETY_KIND_META[selected.kind].labelKey)}</Text>
            {selectedKm !== null ? <Text style={[styles.km, { color: c.textMuted }]}>{formatDistance(selectedKm, locale)}</Text> : null}
            <PressableScale onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={10}>
              <Icon name="x" size={16} color={c.textMuted} />
            </PressableScale>
          </View>
          <Text numberOfLines={1} style={[styles.placeName, { color: c.text }]}>
            {selected.name}
          </Text>
          <View style={styles.cardActions}>
            {selected.phone ? (
              <PressableScale onPress={() => void Linking.openURL(`tel:${selected.phone}`)} style={[styles.action, { backgroundColor: c.inverse }]}>
                <Icon name="phone" size={13} color={c.onInverse} />
                <Text style={[styles.actionText, { color: c.onInverse }]}>{t("home.call")}</Text>
              </PressableScale>
            ) : null}
            {selected.mapsUrl ? (
              <PressableScale onPress={() => void Linking.openURL(selected.mapsUrl!)} style={[styles.action, { backgroundColor: c.surfaceStrong }]}>
                <Icon name="send" size={13} color={c.text} />
                <Text style={[styles.actionText, { color: c.text }]}>{t("home.directions")}</Text>
              </PressableScale>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  otherStop: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  stopHalo: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  stopDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: "#FFFFFF" },
  pin: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  contact: { width: 30, height: 30, borderRadius: 15, borderWidth: 2.5, borderColor: "#3DDC97", backgroundColor: "#0E1018", alignItems: "center", justifyContent: "center" },
  contactInitial: { color: "#FFFFFF", fontFamily: f.semibold, fontSize: 13 },
  globeButton: {
    position: "absolute",
    top: 12,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: Platform.OS === "android" ? 56 : 48,
    borderRadius: 20,
    padding: 14,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  kindDot: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  kind: { fontFamily: f.medium, fontSize: 12.5, flex: 1 },
  km: { fontFamily: f.medium, fontSize: 12.5, fontVariant: ["tabular-nums"] },
  placeName: { fontFamily: f.semibold, fontSize: 15 },
  cardActions: { flexDirection: "row", gap: 8 },
  action: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, height: 30, borderRadius: 15 },
  actionText: { fontFamily: f.semibold, fontSize: 12.5 },
});
