import { distanceKm } from "@/features/trips/utils/mapFraming";

const NEAR_KM = 150;

export interface SaveTarget {
  id: string;
  name: string;
  kind: "trip" | "planned";
  destinations: string[];
  coordinates: ({ latitude: number; longitude: number } | null)[];
  startDate?: string;
}

export interface DetectedPlace {
  label: string;
  kind: "place" | "city" | "country";
  coordinates?: { latitude: number; longitude: number };
}

export type SaveChoice = { kind: "existing"; id: string } | { kind: "new" } | null;

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().trim();

/** Whether a trip is somewhere the detected place is: near one of its stops, or (for a country) one of its stops is in it. */
function goesTo(target: SaveTarget, place: DetectedPlace): boolean {
  if (place.coordinates) {
    return target.coordinates.some((point) => point && distanceKm(point, place.coordinates!) <= NEAR_KM) || target.destinations.some((name) => fold(name) === fold(place.label));
  }
  const country = fold(place.label);
  return target.destinations.some((name) => fold(name) === country || fold(name).endsWith(`, ${country}`)) || fold(target.name).includes(country);
}

/**
 * Save choices for a shared link: the trip at the detected place first, then active, upcoming and
 * planned trips. Defaults to that match, else a new planned trip there, else the active trip, else none.
 */
export function saveTargets(targets: SaveTarget[], activeTripId: string | null, place: DetectedPlace | null): { ordered: SaveTarget[]; choice: SaveChoice } {
  const active = targets.find((target) => target.id === activeTripId && target.kind === "trip");
  const trips = targets.filter((target) => target.kind === "trip" && target !== active).sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  const planned = targets.filter((target) => target.kind === "planned");
  const byPreference = [...(active ? [active] : []), ...trips, ...planned];
  const match = place ? byPreference.find((target) => goesTo(target, place)) : undefined;
  const ordered = match ? [match, ...byPreference.filter((target) => target !== match)] : byPreference;
  const choice: SaveChoice = match ? { kind: "existing", id: match.id } : place ? { kind: "new" } : active ? { kind: "existing", id: active.id } : null;
  return { ordered, choice };
}
