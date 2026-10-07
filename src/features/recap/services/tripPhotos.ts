import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { FilterMode, ImageFormat, MipmapMode, Skia } from "react-native-skia";
import { logger } from "@/modules/logger";
import { photoCurator } from "@/modules/photoCurator";
import { withSystemPrompt } from "@/utils/systemPrompt";
import { useTripPhotosStore, type TripPhoto } from "../store/tripPhotosStore";
import { parseExifDate, parseExifGps } from "../utils/moments";
import type { PhotoCandidate } from "../utils/photoCuration";

/** How many photos the picker allows at once (Android's photo picker may allow fewer). */
export const MAX_PICKED_PHOTOS = 100;
const MAX_EDGE = 1440;
const JPEG_QUALITY = 82;
const ANALYZE_BATCH = 6;
const PHOTOS_DIR = `${FileSystem.documentDirectory}trip-photos/`;

const tripDir = (tripId: string) => `${PHOTOS_DIR}${encodeURIComponent(tripId)}/`;
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A photo from the picker: the picker's temporary copy, kept only while the replay is open. */
export interface PickedPhoto extends PhotoCandidate {
  uri: string;
}

/** Re-encodes a picked photo at most MAX_EDGE px on its long side; null when it can't be decoded. */
async function shrink(uri: string): Promise<{ base64: string; width: number; height: number } | null> {
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!image) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width(), image.height()));
  const width = Math.max(1, Math.round(image.width() * scale));
  const height = Math.max(1, Math.round(image.height() * scale));
  const surface = Skia.Surface.Make(width, height);
  // Freed right away: a full-size decode is ~48 MB, and Hermes can't see that size to collect it soon.
  try {
    if (!surface) return null;
    surface
      .getCanvas()
      .drawImageRectOptions(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, width, height), FilterMode.Linear, MipmapMode.Linear);
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    const base64 = snapshot.encodeToBase64(ImageFormat.JPEG, JPEG_QUALITY);
    snapshot.dispose();
    return { base64, width, height };
  } finally {
    surface?.dispose();
    image.dispose();
  }
}

/**
 * Opens the system photo picker (no photo library permission) for up to `limit` photos, with their
 * capture time and place. Null when the user cancels.
 */
export async function pickPhotos(limit = MAX_PICKED_PHOTOS): Promise<PickedPhoto[] | null> {
  const result = await withSystemPrompt(() =>
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: limit,
      orderedSelection: true,
      exif: true,
      // Re-encoding through the picker also bakes in the EXIF rotation.
      quality: 0.85,
    }),
  );
  if (result.canceled) return null;
  return result.assets.slice(0, limit).map((asset) => {
    const place = parseExifGps(asset.exif);
    return {
      id: newId(),
      uri: asset.uri,
      takenAt: parseExifDate(asset.exif),
      latitude: place?.latitude ?? null,
      longitude: place?.longitude ?? null,
      width: asset.width,
      height: asset.height,
      labels: [],
    };
  });
}

/** Labels and scores the photos on this phone, a few at a time; `onProgress` gets how many are done. */
export async function analyzePhotos(photos: PickedPhoto[], onProgress: (done: number) => void): Promise<PickedPhoto[]> {
  const analyzed: PickedPhoto[] = [];
  for (let i = 0; i < photos.length; i += ANALYZE_BATCH) {
    const batch = photos.slice(i, i + ANALYZE_BATCH);
    const results = await photoCurator.analyze(batch.map((photo) => photo.uri)).catch((err) => {
      logger.warn("trip-photos", "analysis failed", err);
      return null;
    });
    batch.forEach((photo, k) => analyzed.push(results ? { ...photo, ...results[k] } : photo));
    onProgress(analyzed.length);
  }
  return analyzed;
}

/** Keeps a shrunk copy of a picked photo for the trip's replay at `stop`; null when it couldn't be saved. */
export async function keepPhoto(tripId: string, photo: PickedPhoto, stop: number | null, score?: number): Promise<TripPhoto | null> {
  try {
    const small = await shrink(photo.uri);
    if (!small) return null;
    await FileSystem.makeDirectoryAsync(tripDir(tripId), { intermediates: true }).catch(() => {});
    const uri = `${tripDir(tripId)}${photo.id}.jpg`;
    await FileSystem.writeAsStringAsync(uri, small.base64, { encoding: FileSystem.EncodingType.Base64 });
    return { id: photo.id, uri, takenAt: photo.takenAt, latitude: photo.latitude, longitude: photo.longitude, width: small.width, height: small.height, stop, score };
  } catch (err) {
    logger.warn("trip-photos", "couldn't keep a photo", err);
    return null;
  }
}

/** Puts a picked photo in place of a kept one, at the same stop. */
export async function swapTripPhoto(tripId: string, old: TripPhoto, replacement: PickedPhoto, score?: number): Promise<boolean> {
  const kept = await keepPhoto(tripId, replacement, old.stop ?? null, score);
  if (!kept) return false;
  useTripPhotosStore.getState().replacePhoto(tripId, old.id, kept);
  await FileSystem.deleteAsync(old.uri, { idempotent: true }).catch(() => {});
  return true;
}

/** Deletes the picker's temporary copies (the replay closed). */
export async function releasePicked(uris: string[]) {
  await Promise.all(uris.map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})));
}

/** Deletes one photo's file and entry. */
export async function removeTripPhoto(tripId: string, photo: TripPhoto) {
  useTripPhotosStore.getState().removePhoto(tripId, photo.id);
  await FileSystem.deleteAsync(photo.uri, { idempotent: true }).catch(() => {});
}

/** Deletes a trip's photos (trip deleted). */
export async function deleteTripPhotos(tripId: string) {
  useTripPhotosStore.getState().clearTrip(tripId);
  await FileSystem.deleteAsync(tripDir(tripId), { idempotent: true }).catch(() => {});
}

/** Deletes every trip photo (wipe, sign-out). */
export async function deleteAllTripPhotos() {
  useTripPhotosStore.getState().reset();
  await FileSystem.deleteAsync(PHOTOS_DIR, { idempotent: true }).catch(() => {});
}
