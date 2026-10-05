import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

/** A photo the user picked for a trip's replay; a shrunk copy in the app's documents folder. */
export interface TripPhoto {
  id: string;
  uri: string;
  /** Local time from EXIF ("2026-10-18T14:22:05"), when the photo has one. */
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  width: number;
  height: number;
}

interface TripPhotosState {
  /** Per trip; on this phone only, never backed up. */
  photos: Record<string, TripPhoto[]>;
  addPhotos: (tripId: string, photos: TripPhoto[]) => void;
  removePhoto: (tripId: string, id: string) => void;
  clearTrip: (tripId: string) => void;
  reset: () => void;
}

export const useTripPhotosStore = create<TripPhotosState>()(
  persist(
    (set) => ({
      photos: {},
      addPhotos: (tripId, photos) =>
        set((state) => ({
          photos: {
            ...state.photos,
            [tripId]: [...(state.photos[tripId] ?? []), ...photos].sort((a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? "")),
          },
        })),
      removePhoto: (tripId, id) => set((state) => ({ photos: { ...state.photos, [tripId]: (state.photos[tripId] ?? []).filter((photo) => photo.id !== id) } })),
      clearTrip: (tripId) =>
        set((state) => {
          const photos = { ...state.photos };
          delete photos[tripId];
          return { photos };
        }),
      reset: () => set({ photos: {} }),
    }),
    { name: "trip-photos", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
