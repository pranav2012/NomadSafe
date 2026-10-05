import { Skia, type SkPath } from "react-native-skia";
import { countriesInBox, countryRings, type GeoBox } from "../utils/countryShapes";
import { legControl, type MapFrame, type Point } from "../utils/recapMap";
import type { RecapLeg, RecapStop } from "../utils/recapFacts";

export interface RecapGeometry {
  /** Countries the trip touches. */
  home: SkPath;
  /** Neighbours in view, drawn fainter. */
  around: SkPath;
  legs: { path: SkPath; mode: RecapLeg["mode"] }[];
  points: Point[];
  /** Gradient axis for the aurora route: from the lower-left of the route to its upper-right. */
  gradient: [Point, Point];
}

function ringsPath(codes: string[], frame: MapFrame): SkPath {
  const builder = Skia.PathBuilder.Make();
  for (const code of codes) {
    for (const ring of countryRings(code)) {
      ring.forEach(([lon, lat], i) => {
        const p = frame.project(lon, lat);
        if (i === 0) builder.moveTo(p.x, p.y);
        else builder.lineTo(p.x, p.y);
      });
      builder.close();
    }
  }
  return builder.build();
}

/** Projects the trip onto `frame`: outlines of countries within `area`, one curved path per leg, and the stop positions. */
export function buildRecapGeometry(frame: MapFrame, stops: RecapStop[], legs: RecapLeg[], countries: string[], area: GeoBox = frame.box): RecapGeometry {
  const inView = countriesInBox(area);
  const points = stops.map((stop) => frame.project(stop.longitude, stop.latitude));
  const legPaths = legs.flatMap((leg, i) => {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) return [];
    const c = legControl(a, b, leg.mode);
    return [{ path: Skia.PathBuilder.Make().moveTo(a.x, a.y).quadTo(c.x, c.y, b.x, b.y).build(), mode: leg.mode }];
  });
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const gradient: [Point, Point] =
    points.length > 1
      ? [
          { x: Math.min(...xs), y: Math.max(...ys) },
          { x: Math.max(...xs), y: Math.min(...ys) },
        ]
      : [
          { x: 0, y: frame.height },
          { x: frame.width, y: 0 },
        ];
  return {
    home: ringsPath(inView.filter((code) => countries.includes(code)), frame),
    around: ringsPath(inView.filter((code) => !countries.includes(code)), frame),
    legs: legPaths,
    points,
    gradient,
  };
}

/** Dash pattern for a leg: dashes for flights (like the logo's arc), solid for trains, dots for the rest. */
export function legDashes(mode: RecapLeg["mode"], scale = 1): number[] | null {
  if (mode === "flight") return [16 * scale, 13 * scale];
  if (mode === "train") return null;
  return [0.1, 14 * scale];
}

export const AURORA = ["#22C7B8", "#5B6CFF", "#9B7BFF"];
export const AURORA_STOPS = [0, 0.55, 1];
