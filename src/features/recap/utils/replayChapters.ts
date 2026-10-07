export type Chapter =
  | { kind: "intro" }
  | { kind: "stop"; index: number; photos: number; highlights: boolean }
  | { kind: "distance" }
  | { kind: "countries" }
  | { kind: "companions" }
  | { kind: "numbers" }
  | { kind: "stamp" }
  | { kind: "finale" };

const ARRIVAL_MS = 3000;
const PHOTO_MS = 2600;
const MAP_ONLY_MS = 3400;
const HIGHLIGHTS_MS = 1400;
const FIXED_MS = { intro: 4200, distance: 4800, countries: 4400, companions: 4000, numbers: 5000, stamp: 4600 } as const;
/** Trips shorter than this don't get a distance chapter. */
export const DISTANCE_CHAPTER_KM = 30;

/** The replay's chapters, in order; optional ones only when there is something to show. */
export function replayChapters(input: {
  photosPerStop: number[];
  highlightsPerStop: number[];
  totalKm: number;
  countries: boolean;
  companions: boolean;
  stamped: boolean;
}): Chapter[] {
  return [
    { kind: "intro" },
    ...input.photosPerStop.map((photos, index): Chapter => ({ kind: "stop", index, photos, highlights: (input.highlightsPerStop[index] ?? 0) > 0 })),
    ...(input.totalKm >= DISTANCE_CHAPTER_KM ? [{ kind: "distance" } as const] : []),
    ...(input.countries ? [{ kind: "countries" } as const] : []),
    ...(input.companions ? [{ kind: "companions" } as const] : []),
    { kind: "numbers" },
    ...(input.stamped ? [{ kind: "stamp" } as const] : []),
    { kind: "finale" },
  ];
}

/** How long a chapter plays; a stop grows with its photos. The finale waits for the user (0). */
export function chapterMs(chapter: Chapter): number {
  if (chapter.kind === "finale") return 0;
  if (chapter.kind === "stop") {
    if (chapter.photos > 0) return ARRIVAL_MS + chapter.photos * PHOTO_MS;
    return MAP_ONLY_MS + (chapter.highlights ? HIGHLIGHTS_MS : 0);
  }
  return FIXED_MS[chapter.kind];
}

/** Where a stop chapter's arrival ends and each photo plays, as fractions of the chapter (0..1). */
export function stopPhases(photos: number): { arrival: number; photo: number } {
  if (photos <= 0) return { arrival: 1, photo: 0 };
  const total = ARRIVAL_MS + photos * PHOTO_MS;
  return { arrival: ARRIVAL_MS / total, photo: PHOTO_MS / total };
}
