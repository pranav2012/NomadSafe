import { api, convex } from "@/modules/backend";
import { withAppCheck } from "@/modules/appCheck";
import { findOfflineCoordinates } from "@/features/trips/data/destinations";

export interface LatLng {
  latitude: number;
  longitude: number;
}

const known = new Map<string, Promise<LatLng | null>>();
const keyOf = (label: string) => label.trim().toLocaleLowerCase();

export function getOfflineCoordinates(label: string): LatLng | null {
  return findOfflineCoordinates(label);
}

/** Keeps a search pick's coordinates (or pending lookup) for later geocoding; empty results can retry. */
export function rememberDestination(label: string, coordinates: LatLng | Promise<LatLng | null>) {
  const key = keyOf(label);
  const pending = Promise.resolve(coordinates).catch(() => null);
  known.set(key, pending);
  void pending.then((result) => {
    if (!result && known.get(key) === pending) known.delete(key);
  });
}

/** Search picks first, then the bundled cities, then Google through our server (cached per session). */
export async function geocodeDestination(label: string): Promise<LatLng | null> {
  const key = keyOf(label);
  const remembered = await known.get(key);
  if (remembered) return remembered;

  const offline = findOfflineCoordinates(label);
  if (offline) return offline;

  const lookup = withAppCheck({ query: label })
    .then((args) => convex.action(api.places.geocodeDestination, args))
    .catch(() => {
      known.delete(key);
      return null;
    });
  known.set(key, lookup);
  return lookup;
}

/** Index-aligned with `destinations` (failed lookups are null); `knownCoordinates` skips lookups. */
export function geocodeDestinations(
  destinations: string[],
  knownCoordinates?: ReadonlyMap<string, LatLng | null>,
): Promise<(LatLng | null)[]> {
  return Promise.all(
    destinations.map((destination) => knownCoordinates?.get(destination) ?? geocodeDestination(destination)),
  );
}
