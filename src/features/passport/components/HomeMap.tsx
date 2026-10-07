import React, { useMemo } from "react";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { useBoundaryStore } from "@/features/recap/utils/boundaries";
import { frameRoute } from "@/features/recap/utils/recapMap";
import { countryRegions, mainlandBox, regionRings } from "../utils/regions";

/** The home country's mainland states, with the visited ones filled in aurora. */
export function HomeMap({ country, visited, width, height, paper = false }: { country: string; visited: Set<string>; width: number; height: number; paper?: boolean }) {
  const view = useBoundaryStore((state) => state.view);
  const shapes = useMemo(() => {
    const box = mainlandBox(country);
    if (!box) return [];
    const corners = [
      { latitude: box.south, longitude: box.west },
      { latitude: box.north, longitude: box.east },
    ];
    const frame = frameRoute(corners, width, height, 6);
    return countryRegions(country)
      .filter((region) => !region.far)
      .map((region) => ({
        key: region.key,
        d: regionRings(country, region.key)
          .map((ring) =>
            ring
              .map(([lon, lat], i) => {
                const p = frame.project(lon, lat);
                return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
              })
              .join("") + "Z",
          )
          .join(""),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, width, height, view]);

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="visited" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor="#22C7B8" />
          <Stop offset="0.55" stopColor="#5B6CFF" />
          <Stop offset="1" stopColor="#9B7BFF" />
        </LinearGradient>
      </Defs>
      {shapes.map((shape) =>
        visited.has(shape.key) ? (
          <Path key={shape.key} d={shape.d} fill="url(#visited)" fillOpacity={0.88} stroke="rgba(255,255,255,0.55)" strokeWidth={0.8} strokeLinejoin="round" />
        ) : (
          <Path
            key={shape.key}
            d={shape.d}
            fill={paper ? "rgba(29,34,48,0.05)" : "rgba(255,255,255,0.045)"}
            stroke={paper ? "rgba(29,34,48,0.3)" : "rgba(255,255,255,0.16)"}
            strokeWidth={0.7}
            strokeLinejoin="round"
          />
        ),
      )}
    </Svg>
  );
}
