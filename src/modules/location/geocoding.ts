import * as Location from "expo-location";

export type GeocodedPlace = Pick<
  Location.LocationGeocodedAddress,
  "name" | "street" | "city" | "subregion" | "country" | "isoCountryCode"
>;

/** Places at the coordinates via the OS geocoder (usually needs a network). */
export function reverseGeocode(coords: { latitude: number; longitude: number }): Promise<GeocodedPlace[]> {
  return Location.reverseGeocodeAsync({ latitude: coords.latitude, longitude: coords.longitude });
}
