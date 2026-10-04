import type { ExpenseLocation } from "@/features/expenses/store/expensesStore";
import {
  getCurrentPosition,
  getForegroundPermission,
  requestForegroundPermission,
  reverseGeocode,
  type GeocodedPlace,
} from "@/modules/location";

function buildLabel(place: GeocodedPlace): string | undefined {
  const parts = [
    place.name && place.name !== place.street ? place.name : null,
    place.city ?? place.subregion,
    place.country,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Returns the device's current location with a human-readable label for tagging
 * an expense. Requests foreground permission if not already granted. Returns
 * null when permission is denied or the position can't be resolved, so expense
 * creation never blocks on location.
 */
export async function getCurrentExpenseLocation(): Promise<ExpenseLocation | null> {
  try {
    const existing = await getForegroundPermission();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const requested = await requestForegroundPermission();
      granted = requested.granted;
    }
    if (!granted) return null;

    const position = await getCurrentPosition("balanced");

    const location: ExpenseLocation = {
      latitude: position.latitude,
      longitude: position.longitude,
    };

    try {
      const places = await reverseGeocode({
        latitude: location.latitude,
        longitude: location.longitude,
      });
      if (places[0]) {
        location.label = buildLabel(places[0]);
      }
    } catch {
      // Reverse geocoding is best-effort; keep the raw coordinates.
    }

    return location;
  } catch {
    return null;
  }
}
