import * as Location from "expo-location";
import type { ExpenseLocation } from "@/features/expenses/store/expensesStore";

function buildLabel(place: Location.LocationGeocodedAddress): string | undefined {
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
    const existing = await Location.getForegroundPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const requested = await Location.requestForegroundPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return null;

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const location: ExpenseLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };

    try {
      const places = await Location.reverseGeocodeAsync({
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
