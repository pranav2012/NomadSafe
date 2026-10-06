import { distanceKm } from "@/features/trips/utils/mapFraming";

export const IDEA_NEAR_KM = 60;

interface IdeaLike {
  timing?: string;
  doneAt?: string;
  place?: { latitude: number; longitude: number };
}

interface Point {
  latitude: number;
  longitude: number;
}

/** A trip's saved ideas: wishlist items not yet done, in the order given. */
export function ideasOf<T extends IdeaLike>(events: T[]): T[] {
  return events.filter((event) => event.timing === "wishlist" && !event.doneAt);
}

/** Ideas pinned within `IDEA_NEAR_KM` of `point`, nearest first; ideas with no place are left out. */
export function ideasNear<T extends IdeaLike>(ideas: T[], point: Point): T[] {
  return ideas
    .filter((idea) => idea.place && distanceKm(idea.place, point) <= IDEA_NEAR_KM)
    .sort((a, b) => distanceKm(a.place!, point) - distanceKm(b.place!, point));
}

/** Index of the stop an idea belongs to (the nearest within `IDEA_NEAR_KM`), or null when it has no place or none is close. */
export function stopIndexOf(idea: IdeaLike, stops: Point[]): number | null {
  if (!idea.place) return null;
  let best: { index: number; km: number } | null = null;
  stops.forEach((stop, index) => {
    const km = distanceKm(idea.place!, stop);
    if (km <= IDEA_NEAR_KM && (!best || km < best.km)) best = { index, km };
  });
  return (best as { index: number } | null)?.index ?? null;
}
