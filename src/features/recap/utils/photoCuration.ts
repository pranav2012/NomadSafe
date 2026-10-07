import { addDays, fromDateKey, toDateKey } from "@/features/trips/utils/dates";
import type { MapPoint } from "@/features/trips/utils/mapFraming";
import { nearestStop } from "./moments";
import { stopOnDay, type StopStay } from "./replayFacts";

export const PHOTOS_PER_STOP = 3;
export const MAX_CHOSEN_PHOTOS = 24;
const BURST_SECONDS = 60;
const REJECT_CONFIDENCE = 0.55;
/** Pictures this much covered by text are receipts, tickets or screenshots, not moments. */
const TEXT_COVERAGE = 0.05;

export interface PhotoLabel {
  label: string;
  confidence: number;
}

/** A picked photo with what the phone could tell about it; `labels` is empty where on-device labelling isn't available. */
export interface PhotoCandidate {
  id: string;
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  width: number;
  height: number;
  labels: PhotoLabel[];
  /** Apple's aesthetics score, -1..1 (iOS 18+). */
  aesthetic?: number | null;
  /** Apple's "utility" flag: screenshots, receipts, documents (iOS 18+). */
  utility?: boolean | null;
  /** 0..1, higher is sharper / better exposed. */
  sharpness?: number | null;
  exposure?: number | null;
  /** 0..1, share of the picture covered by text. */
  textCoverage?: number | null;
  /** Already kept for the replay; stays chosen and takes its stop's slot. */
  kept?: { stop: number | null };
}

export type RejectReason = "outsideTrip" | "utility" | "food" | "ground";

export interface CurationResult {
  chosen: { id: string; stop: number }[];
  /** Fine photos that didn't make the cut, best first (offered as swaps). */
  alternates: { id: string; stop: number | null; score: number }[];
  rejected: { id: string; reason: RejectReason }[];
}

const normalize = (label: string) => label.toLowerCase().replace(/[_-]+/g, " ").trim();

// Vision (iOS) and ML Kit (Android) words for things that don't belong in a trip film.
const UTILITY = new Set([
  "screenshot", "document", "receipt", "text", "paper", "menu", "qr code", "barcode", "handwriting", "whiteboard", "invoice",
  "envelope", "letter", "calendar", "chart", "diagram", "spreadsheet", "computer", "monitor", "screen", "keyboard", "laptop",
  "mobile phone", "cell phone", "web site", "website", "font", "number", "ticket", "passport", "id card", "credit card", "map",
]);
const FOOD = new Set([
  "food", "dish", "cuisine", "meal", "dessert", "baked goods", "snack", "fast food", "bread", "pizza", "burger", "hamburger",
  "sushi", "noodle", "noodles", "salad", "soup", "plate", "tableware", "cutlery", "dishware", "breakfast", "lunch", "dinner",
  "sandwich", "pasta", "rice", "meat", "seafood", "cake", "pastry", "ice cream", "fries", "curry", "produce", "fruit", "vegetable",
]);
const GROUND = new Set(["road", "asphalt", "pavement", "tarmac", "parking", "parking lot", "floor", "flooring", "tile", "concrete", "carpet", "ground"]);
const PEOPLE = new Set(["people", "person", "crowd", "group", "selfie", "smile", "fun", "friendship", "adult", "child", "team", "party"]);
const SCENE = new Set([
  "landscape", "landmark", "sky", "beach", "mountain", "building", "architecture", "temple", "church", "castle", "tower", "bridge",
  "monument", "skyline", "cityscape", "city", "sea", "ocean", "lake", "river", "waterfall", "coast", "shore", "island", "forest",
  "nature", "sunset", "sunrise", "snow", "desert", "park", "garden", "travel", "vacation", "hiking", "sculpture", "statue", "palace",
  "night", "fireworks", "festival", "boat", "canyon", "cliff", "valley", "field", "flower", "cloud", "outdoor", "water", "shrine",
  "ruins", "museum", "street", "market", "harbor", "harbour", "hill", "volcano", "glacier", "jungle", "safari", "animal", "wildlife",
]);

function strongest(labels: PhotoLabel[], set: Set<string>): number {
  let best = 0;
  for (const { label, confidence } of labels) if (set.has(normalize(label)) && confidence > best) best = confidence;
  return best;
}

/** Why a photo doesn't belong, or null. Food and ground lose to a stronger scene or people label (a market stall, a road through mountains). */
export function rejectReason(photo: PhotoCandidate, trip: { startDate: string; endDate: string }): RejectReason | null {
  if (photo.takenAt) {
    const day = photo.takenAt.slice(0, 10);
    if (day < toDateKey(addDays(fromDateKey(trip.startDate), -1)) || day > toDateKey(addDays(fromDateKey(trip.endDate), 1))) return "outsideTrip";
  }
  if (photo.utility) return "utility";
  if (typeof photo.textCoverage === "number") {
    if (photo.textCoverage >= TEXT_COVERAGE) return "utility";
    // Screenshots: phone-shaped, no camera time, and some text on them.
    if (photo.textCoverage >= 0.015 && !photo.takenAt && photo.height / Math.max(1, photo.width) > 1.9) return "utility";
  }
  const labels = photo.labels;
  if (strongest(labels, UTILITY) >= REJECT_CONFIDENCE) return "utility";
  const scene = strongest(labels, SCENE);
  const people = strongest(labels, PEOPLE);
  const food = strongest(labels, FOOD);
  if (food >= REJECT_CONFIDENCE && food > Math.max(scene, people)) return "food";
  const ground = strongest(labels, GROUND);
  if (ground >= REJECT_CONFIDENCE && ground > scene && ground > people) return "ground";
  return null;
}

/** How good a photo is for the replay, roughly 0..2. Works without labels, from sharpness and exposure alone. */
export function photoScore(photo: PhotoCandidate): number {
  let score = 0.5;
  score += 0.45 * strongest(photo.labels, SCENE);
  score += 0.25 * strongest(photo.labels, PEOPLE);
  if (typeof photo.aesthetic === "number") score += 0.4 * ((photo.aesthetic + 1) / 2);
  if (typeof photo.sharpness === "number") score += 0.3 * photo.sharpness - 0.15;
  if (typeof photo.exposure === "number") score += 0.15 * photo.exposure - 0.075;
  if (!photo.takenAt) score -= 0.25;
  // Very tall images without a date are usually screenshots or saved images.
  if (!photo.takenAt && photo.height / Math.max(1, photo.width) > 1.9) score -= 0.3;
  return score;
}

const seconds = (takenAt: string) => new Date(`${takenAt}Z`).getTime() / 1000;

/**
 * Picks up to `PHOTOS_PER_STOP` photos per stop (`MAX_CHOSEN_PHOTOS` in all): drops photos from
 * outside the trip and ones that aren't moments, keeps the best of each burst, and spreads each
 * stop's picks across its days. Photos go to the stop they were taken near, else the stop the trip
 * was at that day, else (no date or place) by their order in the selection.
 */
export function curatePhotos(
  candidates: PhotoCandidate[],
  context: { startDate: string; endDate: string; stops: MapPoint[]; schedule: StopStay[] },
): CurationResult {
  const { stops, schedule } = context;
  const rejected: CurationResult["rejected"] = [];
  const accepted: { photo: PhotoCandidate; stop: number | null; score: number; day: string | null; order: number }[] = [];
  candidates.forEach((photo, order) => {
    const reason = photo.kept ? null : rejectReason(photo, context);
    if (reason) {
      rejected.push({ id: photo.id, reason });
      return;
    }
    const gps = photo.latitude !== null && photo.longitude !== null ? { latitude: photo.latitude, longitude: photo.longitude } : null;
    const day = photo.takenAt?.slice(0, 10) ?? null;
    let stop: number | null = photo.kept?.stop !== undefined && photo.kept.stop !== null && photo.kept.stop < stops.length ? photo.kept.stop : null;
    if (stop === null && stops.length === 1) stop = 0;
    if (stop === null) stop = nearestStop(gps, stops);
    if (stop === null && day) stop = stopOnDay(schedule, day);
    if (stop === null && !gps && stops.length > 0) stop = Math.min(stops.length - 1, Math.floor((order * stops.length) / Math.max(1, candidates.length)));
    accepted.push({ photo, stop, score: photoScore(photo), day, order });
  });

  // Bursts: photos within a minute of each other at the same stop; keep the best (a kept photo always wins).
  const dated = accepted.filter((item) => item.photo.takenAt).sort((a, b) => a.photo.takenAt!.localeCompare(b.photo.takenAt!));
  const burstLosers = new Set<PhotoCandidate>();
  let burst: typeof dated = [];
  const closeBurst = () => {
    if (burst.length > 1) {
      const rank = (item: (typeof dated)[number]) => (item.photo.kept ? 100 : 0) + item.score;
      const winner = burst.reduce((best, item) => (rank(item) > rank(best) ? item : best), burst[0]);
      for (const item of burst) if (item !== winner && !item.photo.kept) burstLosers.add(item.photo);
    }
    burst = [];
  };
  for (const item of dated) {
    const previous = burst[burst.length - 1];
    if (previous && (previous.stop !== item.stop || seconds(item.photo.takenAt!) - seconds(previous.photo.takenAt!) > BURST_SECONDS)) closeBurst();
    burst.push(item);
  }
  closeBurst();

  const chosen: CurationResult["chosen"] = [];
  const chosenSet = new Set<PhotoCandidate>();
  const pick = (item: (typeof accepted)[number]) => {
    chosen.push({ id: item.photo.id, stop: item.stop! });
    chosenSet.add(item.photo);
  };

  for (let stop = 0; stop < stops.length; stop += 1) {
    const here = accepted.filter((item) => item.stop === stop);
    const kept = here.filter((item) => item.photo.kept);
    kept.forEach(pick);
    // Round-robin over days, best day first, so one busy afternoon doesn't fill the stop.
    const byDay = new Map<string, typeof here>();
    for (const item of here) {
      if (item.photo.kept || burstLosers.has(item.photo)) continue;
      const key = item.day ?? "";
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    const queues = [...byDay.values()].map((items) => items.sort((a, b) => b.score - a.score)).sort((a, b) => b[0].score - a[0].score);
    let slots = PHOTOS_PER_STOP - kept.length;
    while (slots > 0 && queues.some((queue) => queue.length > 0)) {
      for (const queue of queues) {
        if (slots <= 0) break;
        const next = queue.shift();
        if (!next) continue;
        pick(next);
        slots -= 1;
      }
    }
  }

  // Over the cap: drop the weakest new picks from the stops with the most photos.
  while (chosen.length > MAX_CHOSEN_PHOTOS) {
    const counts = new Map<number, number>();
    for (const item of chosen) counts.set(item.stop, (counts.get(item.stop) ?? 0) + 1);
    let worst = -1;
    let worstRank = Infinity;
    chosen.forEach((item, i) => {
      const entry = accepted.find((a) => a.photo.id === item.id)!;
      if (entry.photo.kept) return;
      const rank = entry.score - (counts.get(item.stop) ?? 0);
      if (rank < worstRank) {
        worstRank = rank;
        worst = i;
      }
    });
    if (worst < 0) break;
    chosenSet.delete(accepted.find((a) => a.photo.id === chosen[worst].id)!.photo);
    chosen.splice(worst, 1);
  }

  const alternates = accepted
    .filter((item) => !chosenSet.has(item.photo) && !item.photo.kept)
    .sort((a, b) => b.score - a.score)
    .map((item) => ({ id: item.photo.id, stop: item.stop, score: item.score }));
  return { chosen, alternates, rejected };
}

/**
 * A trip's kept photos per stop (best first, at most `limit`). Photos kept before stops
 * were stored are placed by GPS, then date.
 */
export function photosByStop<T extends { stop?: number | null; score?: number; takenAt: string | null; latitude: number | null; longitude: number | null }>(
  photos: T[],
  stops: MapPoint[],
  schedule: StopStay[],
  limit = PHOTOS_PER_STOP,
): T[][] {
  const byStop: T[][] = stops.map(() => []);
  for (const photo of photos) {
    let stop = photo.stop ?? null;
    if (stop === null || stop >= stops.length) {
      const gps = photo.latitude !== null && photo.longitude !== null ? { latitude: photo.latitude, longitude: photo.longitude } : null;
      stop = stops.length === 1 ? 0 : (nearestStop(gps, stops) ?? (photo.takenAt ? stopOnDay(schedule, photo.takenAt.slice(0, 10)) : null));
    }
    if (stop !== null) byStop[stop].push(photo);
  }
  return byStop.map((list) => list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.takenAt ?? "").localeCompare(b.takenAt ?? "")).slice(0, limit));
}
