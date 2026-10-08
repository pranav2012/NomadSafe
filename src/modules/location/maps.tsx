import { useEffect, useState, type ComponentPropsWithRef } from "react";
import type NativeMapView from "react-native-maps";
import type { MapMarker, MapPolyline } from "react-native-maps";

type Maps = typeof import("react-native-maps");

let maps: Maps | undefined;

/**
 * react-native-maps is required on first render, not at import: its native module would otherwise
 * load on headless launches that only run the background location task.
 */
function loadMaps(): Maps {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  maps ??= require("react-native-maps") as Maps;
  return maps;
}

/** Imperative map handle (animateToRegion, fitToCoordinates…) for `useRef<MapViewHandle>`. */
export type MapViewHandle = NativeMapView;
/** Without `provider`, Android uses Google Maps and iOS Apple Maps. */
export type MapViewProps = ComponentPropsWithRef<typeof NativeMapView>;
export type MapMarkerProps = ComponentPropsWithRef<typeof MapMarker>;
export type MapPolylineProps = ComponentPropsWithRef<typeof MapPolyline>;
export type { LatLng, MapStyleElement, Region } from "react-native-maps";

export function MapView(props: MapViewProps) {
  const { default: Map } = loadMaps();
  return <Map {...props} />;
}

export function Marker(props: MapMarkerProps) {
  const { Marker: NativeMarker } = loadMaps();
  return <NativeMarker {...props} />;
}

export function Polyline(props: MapPolylineProps) {
  const { Polyline: NativePolyline } = loadMaps();
  return <NativePolyline {...props} />;
}

/**
 * `tracksViewChanges` for a custom marker. Android draws a marker into a bitmap, often before its
 * contents have drawn, so it tracks for a moment after mounting and whenever `key` (whatever the
 * marker shows) changes, then stops to save redraws.
 */
export function useMarkerTracking(key: string, ms = 600): boolean {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(key), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return settled !== key;
}
