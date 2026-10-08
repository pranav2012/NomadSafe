import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAura } from "@/atoms";
import { auraEventColors } from "@/constants/aura";
import { quietMapStyle } from "@/features/home/components/aura/mapStyles";
import { isCompactFrame, regionForPoints, type MapPoint } from "@/features/trips/utils/mapFraming";
import type { EventType } from "@/features/itinerary/constants/eventTypes";
import { MapView, Marker, Polyline, useMarkerTracking, type MapViewHandle } from "@/modules/location";

export interface PlanPin extends MapPoint {
  id: string;
  label: string;
  type: EventType;
  dim?: boolean;
}

const EDGE_PADDING = { top: 50, right: 40, bottom: 50, left: 40 };
const MARKER_SETTLE_MS = 800;

/**
 * A real map of the plan: numbered pins per item, straight lines between them in order, framed on
 * `focus` (the day in view) and gliding there when it changes. Interactive unless `still`.
 */
export function TripPlanMap({
  pins,
  paths,
  focus,
  height,
  still,
  minDelta = 0.02,
}: {
  pins: PlanPin[];
  paths: MapPoint[][];
  focus: MapPoint[];
  height: number;
  still?: boolean;
  /** Smallest span to frame, in degrees; city-level when pins are whole cities. */
  minDelta?: number;
}) {
  const { c, f, isDark } = useAura();
  const mapRef = useRef<MapViewHandle>(null);
  const style = useMemo(() => quietMapStyle(isDark), [isDark]);
  const frame = focus.length > 0 ? focus : pins;
  const frameKey = frame.map((point) => `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`).join("|");
  const tracking = useMarkerTracking(`${pins.map((pin) => `${pin.id}${pin.label}${pin.dim ? 1 : 0}`).join("|")}#${isDark}`, MARKER_SETTLE_MS);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || frame.length === 0) return;
    if (frame.length > 1 && !isCompactFrame(frame, minDelta)) map.fitToCoordinates(frame, { edgePadding: EDGE_PADDING, animated: true });
    else map.animateToRegion(regionForPoints(frame, minDelta), 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, minDelta]);

  if (pins.length === 0) return null;

  return (
    <View style={[styles.wrap, { height, backgroundColor: c.surface }]} pointerEvents={still ? "none" : "auto"}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={regionForPoints(frame, minDelta)}
        customMapStyle={style}
        userInterfaceStyle={isDark ? "dark" : "light"}
        liteMode={still}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        moveOnMarkerPress={false}
      >
        {paths.map((path, index) =>
          path.length > 1 ? <Polyline key={`path-${index}`} coordinates={path} strokeColor={c.textSoft} strokeWidth={2} lineDashPattern={[5, 6]} zIndex={1} /> : null,
        )}
        {pins.map((pin) => (
          <Marker key={pin.id} coordinate={pin} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracking} zIndex={pin.dim ? 2 : 3}>
            <View style={[styles.pin, { backgroundColor: auraEventColors[pin.type], borderColor: c.bg, opacity: pin.dim ? 0.45 : 1 }]}>
              <Text style={[styles.pinText, { color: c.bg, fontFamily: f.semibold }]}>{pin.label}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  pin: { minWidth: 24, height: 24, paddingHorizontal: 5, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  pinText: { fontSize: 11.5 },
});
