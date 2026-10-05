import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { FilterMode, ImageFormat, MipmapMode, Skia } from "react-native-skia";
import { logger } from "@/modules/logger";
import { withSystemPrompt } from "@/utils/systemPrompt";
import { useTripPhotosStore, type TripPhoto } from "../store/tripPhotosStore";
import { parseExifDate, parseExifGps } from "../utils/moments";

export const MAX_TRIP_PHOTOS = 12;
const MAX_EDGE = 1440;
const JPEG_QUALITY = 82;
const PHOTOS_DIR = `${FileSystem.documentDirectory}trip-photos/`;

const tripDir = (tripId: string) => `${PHOTOS_DIR}${encodeURIComponent(tripId)}/`;
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Re-encodes a picked photo at most MAX_EDGE px on its long side; null when it can't be decoded. */
async function shrink(uri: string): Promise<{ base64: string; width: number; height: number } | null> {
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  if (!image) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width(), image.height()));
  const width = Math.max(1, Math.round(image.width() * scale));
  const height = Math.max(1, Math.round(image.height() * scale));
  const surface = Skia.Surface.Make(width, height);
  if (!surface) return null;
  surface
    .getCanvas()
    .drawImageRectOptions(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, width, height), FilterMode.Linear, MipmapMode.Linear);
  surface.flush();
  return { base64: surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, JPEG_QUALITY), width, height };
}

/**
 * Opens the system photo picker (no photo library permission) for up to the trip's remaining
 * slots, and keeps shrunk copies with their capture time and place. Resolves how many were added.
 */
export async function pickTripPhotos(tripId: string): Promise<number> {
  const existing = useTripPhotosStore.getState().photos[tripId]?.length ?? 0;
  const remaining = MAX_TRIP_PHOTOS - existing;
  if (remaining <= 0) return 0;
  const result = await withSystemPrompt(() =>
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      orderedSelection: true,
      exif: true,
      // Re-encoding through the picker also bakes in the EXIF rotation.
      quality: 0.85,
    }),
  );
  if (result.canceled) return 0;

  await FileSystem.makeDirectoryAsync(tripDir(tripId), { intermediates: true }).catch(() => {});
  const added: TripPhoto[] = [];
  for (const asset of result.assets.slice(0, remaining)) {
    try {
      const small = await shrink(asset.uri);
      if (!small) continue;
      const id = newId();
      const uri = `${tripDir(tripId)}${id}.jpg`;
      await FileSystem.writeAsStringAsync(uri, small.base64, { encoding: FileSystem.EncodingType.Base64 });
      const place = parseExifGps(asset.exif);
      added.push({
        id,
        uri,
        takenAt: parseExifDate(asset.exif),
        latitude: place?.latitude ?? null,
        longitude: place?.longitude ?? null,
        width: small.width,
        height: small.height,
      });
    } catch (err) {
      logger.warn("trip-photos", "couldn't keep a photo", err);
    }
  }
  if (added.length > 0) useTripPhotosStore.getState().addPhotos(tripId, added);
  return added.length;
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
