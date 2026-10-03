import { useEffect, useState } from "react";
import { AlphaType, ColorType, Skia, type SkImage } from "react-native-skia";
import { CLOUD_COLS, CLOUD_ROWS, getGlobalClouds, getStopsWeather, type CloudGrid, type StopWeather } from "@/features/home/services/globeWeather";

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
let lastClouds: SkImage | null = null;

/** Live cloud cover for the whole globe and current weather at each stop, both from Open-Meteo. */
export function useGlobeWeather(stops: { latitude: number; longitude: number }[]) {
  const [clouds, setClouds] = useState<SkImage | null>(lastClouds);
  const [stopWeather, setStopWeather] = useState<{ key: string; data: (StopWeather | null)[] } | null>(null);
  const stopsKey = stops.map((s) => `${s.latitude},${s.longitude}`).join("|");

  useEffect(() => {
    let mounted = true;
    void getGlobalClouds().then((grid) => {
      if (!grid) return;
      lastClouds = cloudImage(grid);
      if (mounted) setClouds(lastClouds);
    });
    return () => {
      mounted = false;
    };
  }, []);

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
