import { Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";

const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const DAY_LAYER = "BlueMarble_ShadedRelief_Bathymetry";
const NIGHT_LAYER = "VIIRS_Black_Marble";
const MAX_SIDE = 1536;
const DIR = `${Paths.cache.uri}globe/`;

/** Equirectangular rectangle in degrees. */
export interface DetailBox {
  west: number;
  south: number;
  width: number;
  height: number;
}

export interface RegionImagery {
  box: DetailBox;
  pixelWidth: number;
  pixelHeight: number;
  dayUri: string;
  nightUri: string;
}

const inflight = new Map<string, Promise<RegionImagery | null>>();

/** Trip box padded by the on-screen view, snapped to whole degrees; null if it crosses the antimeridian or is too wide. */
export function detailBoxFor(stops: { latitude: number; longitude: number }[], centerLng: number, visibleHalfDeg: number): DetailBox | null {
  if (!stops.length) return null;
  const rel = stops.map((s) => ((((s.longitude - centerLng) % 360) + 540) % 360) - 180);
  const pad = Math.max(3, visibleHalfDeg * 2);
  const west = Math.floor(centerLng + Math.min(...rel) - pad);
  const east = Math.ceil(centerLng + Math.max(...rel) + pad);
  const south = Math.max(-85, Math.floor(Math.min(...stops.map((s) => s.latitude)) - pad));
  const north = Math.min(85, Math.ceil(Math.max(...stops.map((s) => s.latitude)) + pad));
  if (west < -180 || east > 180 || east - west > 70 || north - south > 70) return null;
  return { west, south, width: east - west, height: north - south };
}

async function download(layer: string, box: DetailBox, width: number, height: number, path: string) {
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists && info.size > 0) return true;
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: layer,
    STYLES: "",
    CRS: "EPSG:4326",
    // WMS 1.3.0 with EPSG:4326 orders the box lat, lon.
    BBOX: `${box.south},${box.west},${box.south + box.height},${box.west + box.width}`,
    WIDTH: `${width}`,
    HEIGHT: `${height}`,
    FORMAT: "image/jpeg",
  });
  const result = await FileSystem.downloadAsync(`${GIBS_WMS}?${params.toString()}`, path);
  const ok = result.status === 200 && (result.headers["Content-Type"] ?? result.headers["content-type"] ?? "").startsWith("image/");
  if (!ok) await FileSystem.deleteAsync(path, { idempotent: true });
  return ok;
}

/** NASA GIBS day and night imagery for a box, downloaded once into the cache directory. */
export function getRegionImagery(box: DetailBox): Promise<RegionImagery | null> {
  const key = `${box.west}_${box.south}_${box.width}_${box.height}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const scale = MAX_SIDE / Math.max(box.width, box.height);
  const pixelWidth = Math.round(box.width * scale);
  const pixelHeight = Math.round(box.height * scale);
  const dayUri = `${DIR}day_${key}.jpg`;
  const nightUri = `${DIR}night_${key}.jpg`;

  const request = (async () => {
    try {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
      const [day, night] = await Promise.all([
        download(DAY_LAYER, box, pixelWidth, pixelHeight, dayUri),
        download(NIGHT_LAYER, box, pixelWidth, pixelHeight, nightUri),
      ]);
      return day && night ? { box, pixelWidth, pixelHeight, dayUri, nightUri } : null;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}
