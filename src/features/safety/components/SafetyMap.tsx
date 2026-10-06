import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { PrivateView } from "@/modules/analytics";
import { MapView, Marker, type MapViewHandle } from "@/modules/location";
import { Icon, PressableScale } from "@/atoms";
import { auraFonts as f, type AuraPalette } from "@/constants/aura";
import { quietMapStyle } from "@/features/home/components/aura/mapStyles";
import { circleTone } from "@/features/location-sharing/components/CircleAvatar";
import { useLocalization } from "@/localization";

const LIVE = "#3DDC97";

type Point = { latitude: number; longitude: number };

interface SafetyMapProps {
  /** Space covered by the header and the bottom panel, kept clear when framing. */
  topInset: number;
  bottomInset: number;
  palette: AuraPalette;
  accent: string;
  isDark: boolean;
  me: Point | null;
  people: (Point & { name: string; stale: boolean })[];
}

/**
 * Full-screen quiet map of you and everyone sharing with you. It frames all points in the space
 * between the header and the panel, can be panned, and the button re-frames it.
 */
export function SafetyMap({ topInset, bottomInset, palette: c, accent, isDark, me, people }: SafetyMapProps) {
  const { t } = useLocalization();
  const mapRef = useRef<MapViewHandle>(null);
  const style = useMemo(() => quietMapStyle(isDark), [isDark]);

  const points = useMemo(() => [...(me ? [me] : []), ...people.map(({ latitude, longitude }) => ({ latitude, longitude }))], [people, me]);
  const pointsKey = points.map((p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`).join("|");

  const frame = (animated: boolean) => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    map.fitToCoordinates(points.length === 1 ? [offset(points[0], -0.004), offset(points[0], 0.004)] : points, {
      edgePadding: { top: topInset + 40, right: 60, bottom: bottomInset + 40, left: 60 },
      animated,
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => frame(true), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-frame when the points move or the panel resizes
  }, [pointsKey, bottomInset]);

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
            onMapReady={() => frame(false)}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            showsCompass={false}
            showsPointsOfInterests={false}
            moveOnMarkerPress={false}
          >
            {me ? <MeMarker key={`me-${accent}`} coordinate={me} accent={accent} title={t("sharing.youLabel")} /> : null}
            {people.map((person, i) => {
              const tone = circleTone(person.name);
              return (
                <Marker key={`${person.name}-${i}`} coordinate={person} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={person.name}>
                  <View style={[styles.person, { borderColor: person.stale ? c.textMuted : LIVE, backgroundColor: isDark ? "#161922" : "#FFFFFF" }]}>
                    <Text style={[styles.initial, { color: tone }]}>{person.name.charAt(0).toUpperCase()}</Text>
                  </View>
                </Marker>
              );
            })}
          </MapView>
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
          onPress={() => frame(true)}
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

/**
 * Your dot. Android draws a marker into a bitmap once; it tracks view changes for a moment after
 * mounting so the bitmap includes the inner dot. Remount (new key) to change its colour.
 */
function MeMarker({ coordinate, accent, title }: { coordinate: Point; accent: string; title: string }) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracking(false), 600);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracking} title={title}>
      <View style={[styles.meHalo, { backgroundColor: `${accent}33` }]}>
        <View style={[styles.meDot, { backgroundColor: accent }]} />
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
