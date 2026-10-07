import * as Device from "expo-device";
import { Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { ImageFormat, Skia, type SkImage } from "react-native-skia";
import { storage } from "@/modules/storage";
import { TILE_PX, boxDegrees, tileBoxKey, tileColumns, type DetailBox, type TileBox } from "@/features/home/utils/globeTiles";

// Tiles of two fixed NASA mosaics: our own copy on Cloudflare R2 (scripts/mirror-globe-tiles.mjs) first,
// NASA GIBS if that fails or isn't set up. A stitched box never goes stale, so it's kept for good.
const MIRROR = process.env.EXPO_PUBLIC_GLOBE_TILES_URL?.replace(/\/$/, "");
const GIBS_WMTS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";

type Layer = "day" | "night";

function tileUrls(layer: Layer, z: number, row: number, col: number) {
  const ext = layer === "day" ? "jpeg" : "png";
  const gibs =
    layer === "day"
      ? `${GIBS_WMTS}/BlueMarble_ShadedRelief_Bathymetry/default/500m/${z}/${row}/${col}.jpeg`
      : `${GIBS_WMTS}/VIIRS_Black_Marble/default/2016-01-01/500m/${z}/${row}/${col}.png`;
  return MIRROR ? [`${MIRROR}/${layer}/${z}/${row}/${col}.${ext}`, gibs] : [gibs];
}
const DIR = `${Paths.document.uri}globe/v1/`;
const LEGACY_CACHE_DIR = `${Paths.cache.uri}globe/`;
const MAX_PARALLEL = 4;
const TILE_TIMEOUT_MS = 20_000;
const USED_KEY = "globe-imagery:used";
const UNUSED_FOR_MS = 60 * 24 * 3_600_000;
const MAX_BYTES = 100 * 1024 * 1024;

/** Tiles per side of a box: 2 (1024px) on phones with 4 GB of RAM or less, so four decoded boxes fit comfortably. */
export const GLOBE_MAX_TILES = Device.totalMemory != null && Device.totalMemory < 4.5 * 1024 ** 3 ? 2 : 3;

export interface RegionImagery {
  box: DetailBox;
  pixelWidth: number;
  pixelHeight: number;
  dayUri: string;
  nightUri: string;
}

const inflight = new Map<string, Promise<RegionImagery | null>>();
let pruned: Promise<void> | null = null;
let active = 0;
const waiting: (() => void)[] = [];

/** Caps concurrent tile downloads across every box, so a trip's prefetch never floods GIBS. */
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

async function fetchTile(urls: string[]): Promise<SkImage | null> {
  for (const url of urls) {
    const image = await fetchTileFrom(url);
    if (image) return image;
  }
  return null;
}

async function fetchTileFrom(url: string): Promise<SkImage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TILE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !(response.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Downloads a box's tiles, stitches them on a CPU surface and saves one JPEG; skipped if already saved. */
async function buildLayer(layer: Layer, tiles: TileBox, path: string) {
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists && info.size > 0) return true;

  const surface = Skia.Surface.Make(tiles.cols * TILE_PX, tiles.rows * TILE_PX);
  if (!surface) return false;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("black"));
  const total = tileColumns(tiles.level);
  const cells = Array.from({ length: tiles.cols * tiles.rows }, (_, i) => ({ c: i % tiles.cols, r: Math.floor(i / tiles.cols) }));
  const images = await Promise.all(
    cells.map(({ c, r }) => limited(() => fetchTile(tileUrls(layer, tiles.level, tiles.row + r, (tiles.col + c) % total)))),
  );
  // Tiles, the stitched surface and its snapshot are freed here, not left to the GC (~20 MB per layer).
  try {
    if (images.some((image) => !image)) return false;
    images.forEach((image, i) => canvas.drawImage(image!, cells[i].c * TILE_PX, cells[i].r * TILE_PX));
    const snapshot = surface.makeImageSnapshot();
    const base64 = snapshot.encodeToBase64(ImageFormat.JPEG, 90);
    snapshot.dispose();
    const part = `${path}.part`;
    await FileSystem.writeAsStringAsync(part, base64, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.moveAsync({ from: part, to: path });
    return true;
  } finally {
    images.forEach((image) => image?.dispose());
    surface.dispose();
  }
}

function readUsed(): Record<string, number> {
  try {
    return JSON.parse(storage.getString(USED_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function markUsed(key: string) {
  storage.set(USED_KEY, JSON.stringify({ ...readUsed(), [key]: Date.now() }));
}

/** Deletes boxes unused for 60 days, then the least recently used ones beyond 100 MB, plus interrupted writes. */
async function pruneImagery() {
  const files = await FileSystem.readDirectoryAsync(DIR).catch(() => [] as string[]);
  const used = readUsed();
  const boxes = new Map<string, { files: string[]; bytes: number; lastUsed: number }>();
  for (const name of files) {
    if (name.endsWith(".part")) {
      await FileSystem.deleteAsync(`${DIR}${name}`, { idempotent: true });
      continue;
    }
    const key = name.replace(/^(day|night)_/, "").replace(/\.jpg$/, "");
    const info = await FileSystem.getInfoAsync(`${DIR}${name}`);
    const box = boxes.get(key) ?? { files: [], bytes: 0, lastUsed: used[key] ?? 0 };
    box.files.push(name);
    if (info.exists) {
      box.bytes += info.size;
      if (!used[key]) box.lastUsed = Math.max(box.lastUsed, info.modificationTime * 1000);
    }
    boxes.set(key, box);
  }
  const now = Date.now();
  let total = 0;
  const keep: Record<string, number> = {};
  for (const [key, box] of [...boxes].sort((a, b) => b[1].lastUsed - a[1].lastUsed)) {
    if (now - box.lastUsed < UNUSED_FOR_MS && total + box.bytes <= MAX_BYTES) {
      total += box.bytes;
      keep[key] = box.lastUsed;
      continue;
    }
    await Promise.all(box.files.map((name) => FileSystem.deleteAsync(`${DIR}${name}`, { idempotent: true })));
  }
  storage.set(USED_KEY, JSON.stringify(keep));
}

/** NASA day and night imagery for a tile box, downloaded once and kept on the device (pruned once per session). */
export function getRegionImagery(tiles: TileBox): Promise<RegionImagery | null> {
  const key = tileBoxKey(tiles);
  const pending = inflight.get(key);
  if (pending) return pending;

  const dayUri = `${DIR}day_${key}.jpg`;
  const nightUri = `${DIR}night_${key}.jpg`;
  const request = (async () => {
    try {
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
      pruned ??= pruneImagery().catch(() => {});
      await pruned;
      const [day, night] = await Promise.all([buildLayer("day", tiles, dayUri), buildLayer("night", tiles, nightUri)]);
      if (!day || !night) return null;
      markUsed(key);
      return { box: boxDegrees(tiles), pixelWidth: tiles.cols * TILE_PX, pixelHeight: tiles.rows * TILE_PX, dayUri, nightUri };
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
}

/** Downloads boxes one after another in the background, e.g. the trip's other stops, so switching days is instant. */
export async function prefetchRegionImagery(boxes: TileBox[]) {
  for (const box of boxes) await getRegionImagery(box);
}

/** Deletes saved globe imagery; it outlines where the user's trips are. */
export async function clearGlobeImagery() {
  storage.remove(USED_KEY);
  await Promise.all([
    FileSystem.deleteAsync(DIR, { idempotent: true }),
    FileSystem.deleteAsync(LEGACY_CACHE_DIR, { idempotent: true }),
  ]);
}
