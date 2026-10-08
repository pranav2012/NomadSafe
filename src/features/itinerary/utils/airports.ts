type AirportData = typeof import("../data/airports");

// The table (~70 KB) loads on the first lookup rather than at app launch.
function airportRows(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("../data/airports") as AirportData).AIRPORT_ROWS;
}

interface Airport {
  latitude: number;
  longitude: number;
  country: string;
}

let index: Map<string, Airport> | null = null;

function airport(code: string): Airport | null {
  if (!/^[A-Z]{3}$/.test(code)) return null;
  index ??= new Map(
    airportRows().split("\n").map((row) => {
      const [iata, lat, lon, country] = row.split("|");
      return [iata, { latitude: Number(lat), longitude: Number(lon), country }];
    }),
  );
  return index.get(code) ?? null;
}

/** Coordinates of an airport by IATA code ("NRT"), from the bundled table; null when unknown. */
export function airportCoordinates(code: string): { latitude: number; longitude: number } | null {
  const found = airport(code);
  return found ? { latitude: found.latitude, longitude: found.longitude } : null;
}

/** ISO country code of an airport ("JP"); null when unknown. */
export function airportCountry(code: string): string | null {
  return airport(code)?.country ?? null;
}
