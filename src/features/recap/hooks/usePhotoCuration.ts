import { useEffect, useRef, useState } from "react";
import { track } from "@/modules/analytics";
import { photoCurator } from "@/modules/photoCurator";
import { analyzePhotos, keepPhoto, pickPhotos, releasePicked, removeTripPhoto, swapTripPhoto, type PickedPhoto } from "../services/tripPhotos";
import { useTripPhotosStore, type TripPhoto } from "../store/tripPhotosStore";
import { curatePhotos, MAX_CHOSEN_PHOTOS, photoScore, type PhotoCandidate } from "../utils/photoCuration";
import type { TripRecap } from "./useTripRecap";

const EMPTY: TripPhoto[] = [];

export type CurationBusy = { phase: "choosing"; done: number; total: number } | { phase: "saving" };

/** An unused photo from this session's picks, offered as a swap. */
export interface SpareCandidate {
  photo: PickedPhoto;
  stop: number | null;
  score: number;
}

/**
 * The replay's photos: pick many through the system picker, let the phone choose the best per stop,
 * then swap or remove. Spare picks live only while the replay is open; their temporary files are
 * deleted when it closes.
 */
export function usePhotoCuration(recap: TripRecap) {
  const tripId = recap.trip.id;
  const photos = useTripPhotosStore((state) => state.photos[tripId] ?? EMPTY);
  const [spares, setSpares] = useState<SpareCandidate[]>([]);
  const [busy, setBusy] = useState<CurationBusy | null>(null);
  const picked = useRef<string[]>([]);

  useEffect(() => {
    const uris = picked.current;
    return () => void releasePicked(uris);
  }, []);

  /** Picker → on-device analysis → best photos kept. Resolves how many photos are kept now, or null when cancelled. */
  const choose = async (): Promise<number | null> => {
    const fresh = await pickPhotos();
    if (!fresh || fresh.length === 0) return null;
    picked.current.push(...fresh.map((photo) => photo.uri));
    setBusy({ phase: "choosing", done: 0, total: fresh.length });
    try {
      const analyzed = await analyzePhotos(fresh, (done) => setBusy({ phase: "choosing", done, total: fresh.length }));
      const kept = useTripPhotosStore.getState().photos[tripId] ?? EMPTY;
      const keptCandidates: PhotoCandidate[] = kept.map((photo) => ({ ...photo, labels: [], kept: { stop: photo.stop ?? null } }));
      const pool = [...analyzed, ...spares.map((spare) => spare.photo)];
      const result = curatePhotos([...keptCandidates, ...pool], { ...recap.trip, stops: recap.facts.stops, schedule: recap.schedule });

      setBusy({ phase: "saving" });
      const byId = new Map(pool.map((photo) => [photo.id, photo]));
      const added: TripPhoto[] = [];
      for (const choice of result.chosen) {
        const photo = byId.get(choice.id);
        if (!photo) continue;
        const saved = await keepPhoto(tripId, photo, choice.stop, photoScore(photo));
        if (saved) added.push(saved);
      }
      const store = useTripPhotosStore.getState();
      if (added.length > 0) store.addPhotos(tripId, added);
      // Older photos without a stop get the one curation placed them at.
      for (const choice of result.chosen) {
        const old = kept.find((photo) => photo.id === choice.id);
        if (old && old.stop == null) store.replacePhoto(tripId, old.id, { ...old, stop: choice.stop });
      }
      setSpares(result.alternates.flatMap((alt) => (byId.has(alt.id) ? [{ photo: byId.get(alt.id)!, stop: alt.stop, score: alt.score }] : [])));
      track("trip_photos_curated", {
        picked: fresh.length,
        chosen: added.length,
        rejected: result.rejected.length,
        labelled: photoCurator.isAvailable,
      });
      return (useTripPhotosStore.getState().photos[tripId] ?? EMPTY).length;
    } finally {
      setBusy(null);
    }
  };

  /** Puts a spare in place of a kept photo. */
  const swap = async (old: TripPhoto, spare: SpareCandidate) => {
    setBusy({ phase: "saving" });
    try {
      if (!(await swapTripPhoto(tripId, old, spare.photo, spare.score))) return;
      setSpares((list) => list.filter((item) => item !== spare));
      track("trip_photo_edited", { action: "swap" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (photo: TripPhoto) => {
    await removeTripPhoto(tripId, photo);
    track("trip_photo_edited", { action: "remove" });
  };

  /** Spares for a stop: ones taken there first, then the rest, best first. */
  const sparesFor = (stop: number | null) => [...spares].sort((a, b) => Number(b.stop === stop) - Number(a.stop === stop) || b.score - a.score);

  return { photos, spares, sparesFor, busy, choose, swap, remove, isFull: photos.length >= MAX_CHOSEN_PHOTOS };
}

export type PhotoCuration = ReturnType<typeof usePhotoCuration>;
