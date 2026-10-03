import type { MapStyleElement } from "react-native-maps";

interface MapPalette {
  land: string;
  water: string;
  road: string;
  roadMajor: string;
  label: string;
  border: string;
}

const DARK: MapPalette = {
  land: "#11141B",
  water: "#090B10",
  road: "#1C2029",
  roadMajor: "#262B38",
  label: "#5F6578",
  border: "#2A2F3C",
};

const LIGHT: MapPalette = {
  land: "#ECEEF2",
  water: "#D7DCE6",
  road: "#FFFFFF",
  roadMajor: "#F7F8FA",
  label: "#8A8FA0",
  border: "#C9CDD6",
};

function mixHex(a: string, b: string, t: number) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Quiet Google Maps style (Android) whose roads carry a hint of the safety-state accent, so the
 * aura's colour reads as part of the map. iOS uses Apple Maps' own dark/light appearance.
 */
export function auraMapStyle(isDark: boolean, accent: string): MapStyleElement[] {
  const c = isDark ? DARK : LIGHT;
  const road = mixHex(c.road, accent, isDark ? 0.16 : 0.1);
  const roadMajor = mixHex(c.roadMajor, accent, isDark ? 0.3 : 0.2);
  return [
    { elementType: "geometry", stylers: [{ color: c.land }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: c.label }] },
    { elementType: "labels.text.stroke", stylers: [{ color: c.land }] },
    { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: c.border }] },
    { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
    { featureType: "administrative.neighborhood", stylers: [{ visibility: "off" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: road }] },
    { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: roadMajor }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: c.water }] },
    { featureType: "water", elementType: "labels", stylers: [{ visibility: "off" }] },
  ];
}

/** Untinted quiet style with street names kept, so a usable map stays neutral and pins carry the colour. */
export function quietMapStyle(isDark: boolean): MapStyleElement[] {
  return auraMapStyle(isDark, isDark ? DARK.road : LIGHT.road).filter(
    (rule) => !(rule.featureType === "road" && rule.elementType === "labels"),
  );
}
