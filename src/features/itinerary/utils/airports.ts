import { AIRPORT_ROWS } from "../data/airports";

let index: Map<string, { latitude: number; longitude: number }> | null = null;

/** Coordinates of an airport by IATA code ("NRT"), from the bundled table; null when unknown. */
export function airportCoordinates(code: string): { latitude: number; longitude: number } | null {
  if (!/^[A-Z]{3}$/.test(code)) return null;
  index ??= new Map(
    AIRPORT_ROWS.split("\n").map((row) => {
      const [iata, lat, lon] = row.split("|");
      return [iata, { latitude: Number(lat), longitude: Number(lon) }];
    }),
  );
  return index.get(code) ?? null;
}
