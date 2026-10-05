import { useEffect, useMemo, useState } from "react";
import { AlphaType, ColorType, Skia, type SkImage } from "react-native-skia";
import { api, useQueries } from "@/modules/backend";
import {
  CLOUD_COLS,
  CLOUD_ROWS,
  getStopsWeather,
  isCloudGrid,
  readCachedClouds,
  saveCachedClouds,
  type CloudGrid,
  type StopWeather,
} from "@/features/home/services/globeWeather";

/** Packs the cloud grid into a tiny opaque image (R = cover, G = thunderstorm) for the globe shader. */
function cloudImage({ cover, storm }: CloudGrid): SkImage | null {
  const bytes = new Uint8Array(CLOUD_COLS * CLOUD_ROWS * 4);
  cover.forEach((value, i) => {
    bytes[i * 4] = Math.round(value * 255);
    bytes[i * 4 + 1] = storm[i] ? 255 : 0;
    bytes[i * 4 + 3] = 255;
  });
  return Skia.Image.MakeImage(
    { width: CLOUD_COLS, height: CLOUD_ROWS, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
    Skia.Data.fromBytes(bytes),
    CLOUD_COLS * 4,
  );
}

// Last decoded grid, so a remounted globe shows clouds on its first frame.
let lastClouds: { updatedAt: number; image: SkImage } | null = null;

// useQueries returns a server error instead of throwing it, so an outage falls back to the cached grid.
const CLOUD_QUERY = { clouds: { query: api.weather.globeClouds, args: {} } };

/**
 * Live cloud cover for the whole globe (a Convex subscription the server refreshes hourly from MET
 * Norway, so it updates in place) and current weather at each stop.
 */
export function useGlobeWeather(stops: { latitude: number; longitude: number }[]) {
  const result = useQueries(CLOUD_QUERY).clouds as (CloudGrid & { updatedAt: number }) | null | Error | undefined;
  const live = result instanceof Error ? undefined : result;
  const [offline] = useState<SkImage | null>(() => {
    if (lastClouds) return lastClouds.image;
    const cached = readCachedClouds();
    return cached ? cloudImage(cached) : null;
  });
  const liveImage = useMemo(
    () => (!isCloudGrid(live) ? null : lastClouds?.updatedAt === live.updatedAt ? lastClouds.image : cloudImage(live)),
    [live],
  );
  const clouds = liveImage ?? offline;
  const [stopWeather, setStopWeather] = useState<{ key: string; data: (StopWeather | null)[] } | null>(null);
  const stopsKey = stops.map((s) => `${s.latitude},${s.longitude}`).join("|");

  useEffect(() => {
    if (!isCloudGrid(live) || !liveImage || lastClouds?.updatedAt === live.updatedAt) return;
    lastClouds = { updatedAt: live.updatedAt, image: liveImage };
    saveCachedClouds(live, live.updatedAt);
  }, [live, liveImage]);

  useEffect(() => {
    let mounted = true;
    void getStopsWeather(stops).then((data) => {
      if (mounted && data) setStopWeather({ key: stopsKey, data });
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey]);

  return { clouds, stopWeather: stopWeather?.key === stopsKey ? stopWeather.data : [] };
}
