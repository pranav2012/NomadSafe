import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { PrivateView } from "@/modules/analytics";
import { MapView, Marker, type MapViewHandle } from "@/modules/location";
import { Icon, LiveDot, PressableScale } from "@/atoms";
import { auraFonts as f, type AuraPalette } from "@/constants/aura";
import { quietMapStyle } from "@/features/home/components/aura/mapStyles";
import { useLocalization } from "@/localization";

const CONTACT = "#3DDC97";
const EDGE_PADDING = { top: 110, right: 60, bottom: 90, left: 60 };

type Point = { latitude: number; longitude: number };

interface SafetyMapHeroProps {
  height: number;
  topInset: number;
  title: string;
  statusLabel: string;
  statusLive: boolean;
  palette: AuraPalette;
  accent: string;
  isDark: boolean;
  me: Point | null;
  contacts: (Point & { name: string; stale: boolean })[];
  onTouchActive: (active: boolean) => void;
}

/**
 * Full-bleed quiet map of you and everyone sharing with you, under the screen title and status.
 * It frames all live points and can be panned; the button re-frames it.
 */
export function SafetyMapHero({
  height,
  topInset,
  title,
  statusLabel,
  statusLive,
  palette: c,
  accent,
  isDark,
  me,
  contacts,
  onTouchActive,
}: SafetyMapHeroProps) {
  const { t } = useLocalization();
  const mapRef = useRef<MapViewHandle>(null);
  const style = useMemo(() => quietMapStyle(isDark), [isDark]);

  const points = useMemo(() => [...(me ? [me] : []), ...contacts.map(({ latitude, longitude }) => ({ latitude, longitude }))], [contacts, me]);
  const pointsKey = points.map((p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`).join("|");

  const frame = (animated: boolean) => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.animateToRegion({ ...points[0], latitudeDelta: 0.03, longitudeDelta: 0.03 }, animated ? 600 : 0);
    } else {
      map.fitToCoordinates(points, { edgePadding: EDGE_PADDING, animated });
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => frame(true), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-frame only when the points move
  }, [pointsKey]);

  const first = points[0];

  return (
    <View style={{ height }}>
      {first ? (
        <PrivateView style={StyleSheet.absoluteFill}>
          <View
            style={StyleSheet.absoluteFill}
            onTouchStart={() => onTouchActive(true)}
            onTouchEnd={() => onTouchActive(false)}
            onTouchCancel={() => onTouchActive(false)}
          >
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
              {me ? (
                <Marker coordinate={me} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={t("sharing.youLabel")}>
                  <View style={[styles.meHalo, { backgroundColor: `${accent}33` }]}>
                    <View style={[styles.meDot, { backgroundColor: accent }]} />
                  </View>
                </Marker>
              ) : null}
              {contacts.map((contact, i) => (
                <Marker
                  key={`${contact.name}-${i}`}
                  coordinate={contact}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                  title={contact.name}
                >
                  <View style={[styles.contact, { borderColor: contact.stale ? c.textMuted : CONTACT }]}>
                    <Text style={styles.contactInitial}>{contact.name.charAt(0).toUpperCase()}</Text>
                  </View>
                </Marker>
              ))}
            </MapView>
          </View>
        </PrivateView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]}>
          <Icon name="globe" size={30} color={c.textMuted} />
          <Text style={[styles.fallbackText, { color: c.textMuted }]}>{t("sharing.noLocation")}</Text>
        </View>
      )}

      <LinearGradient pointerEvents="none" colors={[c.bg, `${c.bg}00`]} style={[styles.topFade, { height: topInset + 90 }]} />
      <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.bottomFade} />

      <View style={[styles.header, { top: topInset + 10 }]} pointerEvents="box-none">
        <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>
          {title}
        </Text>
        <View style={[styles.pill, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]} accessibilityLiveRegion="polite">
          <LiveDot color={accent} active={statusLive} size={7} />
          <Text style={[styles.pillText, { color: c.text }]}>{statusLabel}</Text>
        </View>
      </View>

      {points.length > 0 ? (
        <PressableScale
          onPress={() => frame(true)}
          accessibilityRole="button"
          accessibilityLabel={t("safety.recenterMap")}
          style={[styles.recenter, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }]}
        >
          <Icon name="mapPin" size={17} color={c.text} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topFade: { position: "absolute", top: 0, left: 0, right: 0 },
  bottomFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 80 },
  header: { position: "absolute", left: 20, right: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontFamily: f.semibold, fontSize: 30, letterSpacing: -0.9 },
  pill: { flexDirection: "row", alignItems: "center", gap: 7, height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  pillText: { fontFamily: f.medium, fontSize: 12.5 },
  recenter: {
    position: "absolute",
    right: 16,
    bottom: 34,
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
  contact: { width: 30, height: 30, borderRadius: 15, borderWidth: 2.5, backgroundColor: "#0E1018", alignItems: "center", justifyContent: "center" },
  contactInitial: { color: "#FFFFFF", fontFamily: f.semibold, fontSize: 13 },
});
