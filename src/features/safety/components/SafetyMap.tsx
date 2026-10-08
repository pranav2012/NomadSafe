import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useIsFocused } from "expo-router";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { PrivateView } from "@/modules/analytics";
import { MapView, Marker, useMarkerTracking, type MapViewHandle } from "@/modules/location";
import { Icon, PressableScale } from "@/atoms";
import { auraFonts as f, type AuraPalette } from "@/constants/aura";
import { quietMapStyle } from "@/features/home/components/aura/mapStyles";
import { circleTone } from "@/features/location-sharing/components/CircleAvatar";
import { useLocalization } from "@/localization";

const LIVE = "#3DDC97";
const REVEAL_MS = 200;
// Shows the map even if Google never reports its tiles drawn (offline, no Play services). A map
// re-created on return draws from its cache, so it waits less.
const REVEAL_FALLBACK_MS = 2000;
const RETURN_FALLBACK_MS = 400;
// Long enough for the screen to be hidden (tab switch) or covered (pushed screen) first.
const COVER_AFTER_BLUR_MS = 500;
// Room kept around the points inside the clear area, on top of the header and panel insets.
const FRAME_PADDING = { top: 40, right: 60, bottom: 80, left: 60 };
const ME_ZOOM = 15;

type Point = { latitude: number; longitude: number };

interface SafetyMapProps {
  /** Space covered by the header and the bottom panel (up to its top edge). Framing and Google's logo stay clear of it. */
  topInset: number;
  bottomInset: number;
  palette: AuraPalette;
  accent: string;
  isDark: boolean;
  me: Point | null;
  people: (Point & { name: string; stale: boolean })[];
  /** Fetches a fresh fix for you; the map follows it once it lands. */
  onLocate: () => void;
}

/**
 * Full-screen quiet map of you and everyone sharing with you. It frames all points in the space
 * between the header and the panel, can be panned, and the button zooms to you until you pan away.
 */
export function SafetyMap({ topInset, bottomInset, palette: c, accent, isDark, me, people, onLocate }: SafetyMapProps) {
  const { t } = useLocalization();
  const mapRef = useRef<MapViewHandle>(null);
  const style = useMemo(() => quietMapStyle(isDark), [isDark]);

  const points = useMemo(() => [...(me ? [me] : []), ...people.map(({ latitude, longitude }) => ({ latitude, longitude }))], [people, me]);
  const pointsKey = points.map((p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`).join("|");

  const mapPadding = { top: topInset, right: 0, bottom: bottomInset, left: 0 };
  // Android adds edgePadding to mapPadding; iOS measures it from the map's edges.
  const edgePadding =
    Platform.OS === "android"
      ? FRAME_PADDING
      : { ...FRAME_PADDING, top: FRAME_PADDING.top + topInset, bottom: FRAME_PADDING.bottom + bottomInset };

  const followMe = useRef(false);
  const frame = (animated: boolean) => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    if (followMe.current && me) {
      map.animateCamera({ center: me, zoom: ME_ZOOM }, { duration: animated ? 500 : 0 });
      return;
    }
    map.fitToCoordinates(points.length === 1 ? [offset(points[0], -0.004), offset(points[0], 0.004)] : points, {
      edgePadding,
      animated,
    });
  };

  // The page background covers the map until its tiles have drawn, then fades away. Android
  // re-creates the map whenever the screen is shown again (onMapReady fires again), so it's covered
  // shortly after the screen is left and fades back in once the new map draws.
  const cover = useSharedValue(1);
  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.get() }));
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedOnce = useRef(false);
  const reveal = () => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    loadedOnce.current = true;
    cover.set(withTiming(0, { duration: REVEAL_MS }));
  };
  const coverUntilLoaded = () => {
    cover.set(1);
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = setTimeout(reveal, loadedOnce.current ? RETURN_FALLBACK_MS : REVEAL_FALLBACK_MS);
  };
  useEffect(() => {
    coverUntilLoaded();
    return () => {
      if (fallback.current) clearTimeout(fallback.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- arm the fallback once on mount
  }, []);
  const focused = useIsFocused();
  useEffect(() => {
    if (!loadedOnce.current) return;
    if (focused) {
      if (cover.get() > 0 && !fallback.current) fallback.current = setTimeout(reveal, RETURN_FALLBACK_MS);
      return;
    }
    const timer = setTimeout(() => cover.set(1), COVER_AFTER_BLUR_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on focus changes only
  }, [focused]);

  // Android's map crashes if its padding changes after layout but before the map is ready, so the
  // padding is only set once it is, and the map is framed again once that has landed.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => frame(true), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-frame when the points move, the panel resizes or the padding lands
  }, [pointsKey, bottomInset, ready]);

  const locate = () => {
    followMe.current = true;
    frame(true);
    onLocate();
  };

  const first = points[0];

  return (
    <View style={StyleSheet.absoluteFill}>
      {first ? (
        <PrivateView style={StyleSheet.absoluteFill}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={{ ...first, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
            customMapStyle={style}
            userInterfaceStyle={isDark ? "dark" : "light"}
            mapPadding={ready ? mapPadding : undefined}
            onMapReady={() => {
              coverUntilLoaded();
              setReady(true);
              frame(false);
            }}
            onMapLoaded={reveal}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            showsCompass={false}
            showsPointsOfInterests={false}
            moveOnMarkerPress={false}
            onPanDrag={() => {
              followMe.current = false;
            }}
          >
            {me ? <MeMarker key={`me-${accent}`} coordinate={me} accent={accent} title={t("sharing.youLabel")} /> : null}
            {people.map((person, i) => (
              <PersonMarker
                key={`${person.name}-${i}`}
                coordinate={person}
                name={person.name}
                ring={person.stale ? c.textMuted : LIVE}
                fill={isDark ? "#161922" : "#FFFFFF"}
              />
            ))}
          </MapView>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }, coverStyle]} />
        </PrivateView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback, { paddingBottom: bottomInset, backgroundColor: c.bg }]}>
          <Icon name="globe" size={30} color={c.textMuted} />
          <Text style={[styles.fallbackText, { color: c.textMuted }]}>{t("sharing.noLocation")}</Text>
        </View>
      )}

      <LinearGradient pointerEvents="none" colors={[c.bg, `${c.bg}00`]} style={[styles.topFade, { height: topInset + 30 }]} />

      {points.length > 0 ? (
        <PressableScale
          onPress={locate}
          accessibilityRole="button"
          accessibilityLabel={t("safety.recenterMap")}
          style={[styles.recenter, { top: topInset + 8, backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
        >
          <Icon name="mapPin" size={17} color={c.text} />
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Your dot. Remount (new key) to change its colour. */
function MeMarker({ coordinate, accent, title }: { coordinate: Point; accent: string; title: string }) {
  const tracking = useMarkerTracking(accent);
  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracking} title={title}>
      <View style={[styles.meHalo, { backgroundColor: `${accent}33` }]}>
        <View style={[styles.meDot, { backgroundColor: accent }]} />
      </View>
    </Marker>
  );
}

/** Someone sharing with you: their initial in a ring that turns grey when their location is stale. */
function PersonMarker({ coordinate, name, ring, fill }: { coordinate: Point; name: string; ring: string; fill: string }) {
  const tracking = useMarkerTracking(`${name}|${ring}|${fill}`);
  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracking} title={name}>
      <View style={[styles.person, { borderColor: ring, backgroundColor: fill }]}>
        <Text style={[styles.initial, { color: circleTone(name) }]}>{name.charAt(0).toUpperCase()}</Text>
      </View>
    </Marker>
  );
}

/** A point nudged diagonally, so a single point frames at street level instead of max zoom. */
function offset(point: Point, delta: number): Point {
  return { latitude: point.latitude + delta, longitude: point.longitude + delta };
}

const styles = StyleSheet.create({
  topFade: { position: "absolute", top: 0, left: 0, right: 0 },
  recenter: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  fallback: { alignItems: "center", justifyContent: "center", gap: 8 },
  fallbackText: { fontFamily: f.medium, fontSize: 13.5 },
  meHalo: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  meDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: "#FFFFFF" },
  person: { width: 32, height: 32, borderRadius: 16, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
  initial: { fontFamily: f.semibold, fontSize: 13 },
});
