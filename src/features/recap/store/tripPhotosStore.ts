import * as FileSystem from "expo-file-system/legacy";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

/** A photo kept for a trip's replay; a shrunk copy in the app's documents folder. */
export interface TripPhoto {
  id: string;
  uri: string;
  /** Local time from EXIF ("2026-10-18T14:22:05"), when the photo has one. */
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  width: number;
  height: number;
  /** The stop it plays at; photos kept by v1 have none and are placed by GPS or date. */
  stop?: number | null;
  /** Curation score, for ordering a stop's photos (best first). */
  score?: number;
}

interface TripPhotosState {
  /** Per trip; on this phone only, never backed up. */
  photos: Record<string, TripPhoto[]>;
  addPhotos: (tripId: string, photos: TripPhoto[]) => void;
  removePhoto: (tripId: string, id: string) => void;
  /** Puts `photo` where `id` was (a swap keeps the stop and order). */
  replacePhoto: (tripId: string, id: string, photo: TripPhoto) => void;
  clearTrip: (tripId: string) => void;
  reset: () => void;
}

const MARKER = "/trip-photos/";

/**
 * Points a stored photo at today's documents folder. iOS moves the app's container on updates and
 * reinstalls, so absolute paths saved earlier stop resolving.
 */
function rebase(photo: TripPhoto): TripPhoto {
  const at = photo.uri.indexOf(MARKER);
  const docs = FileSystem.documentDirectory;
  if (at < 0 || !docs) return photo;
  const uri = `${docs.replace(/\/$/, "")}${photo.uri.slice(at)}`;
  return uri === photo.uri ? photo : { ...photo, uri };
}

const byTime = (a: TripPhoto, b: TripPhoto) => (a.takenAt ?? "").localeCompare(b.takenAt ?? "");

export const useTripPhotosStore = create<TripPhotosState>()(
  persist(
    (set) => ({
      photos: {},
      addPhotos: (tripId, photos) =>
        set((state) => ({ photos: { ...state.photos, [tripId]: [...(state.photos[tripId] ?? []), ...photos].sort(byTime) } })),
      removePhoto: (tripId, id) => set((state) => ({ photos: { ...state.photos, [tripId]: (state.photos[tripId] ?? []).filter((photo) => photo.id !== id) } })),
      replacePhoto: (tripId, id, photo) =>
        set((state) => ({ photos: { ...state.photos, [tripId]: (state.photos[tripId] ?? []).map((item) => (item.id === id ? photo : item)).sort(byTime) } })),
      clearTrip: (tripId) =>
        set((state) => {
          const photos = { ...state.photos };
          delete photos[tripId];
          return { photos };
        }),
      reset: () => set({ photos: {} }),
    }),
    {
      name: "trip-photos",
      storage: createJSONStorage(() => mmkvStateStorage),
      // v1 added each photo's stop and score; older photos keep working without them.
      version: 1,
      migrate: (persisted) => ({ photos: ((persisted ?? {}) as { photos?: Record<string, TripPhoto[]> }).photos ?? {} }) as TripPhotosState,
      merge: (persisted, current) => {
        const stored = ((persisted ?? {}) as { photos?: Record<string, TripPhoto[]> }).photos ?? {};
        return { ...current, photos: Object.fromEntries(Object.entries(stored).map(([tripId, list]) => [tripId, list.map(rebase)])) };
      },
    },
  ),
);
