export interface LatLng {
  latitude: number;
  longitude: number;
}

const CITY_COORDINATES: Record<string, LatLng> = {
  amsterdam: { latitude: 52.3676, longitude: 4.9041 },
  athens: { latitude: 37.9838, longitude: 23.7275 },
  auckland: { latitude: -36.8509, longitude: 174.7645 },
  bangkok: { latitude: 13.7563, longitude: 100.5018 },
  barcelona: { latitude: 41.3851, longitude: 2.1734 },
  berlin: { latitude: 52.52, longitude: 13.405 },
  bengaluru: { latitude: 12.9716, longitude: 77.5946 },
  bangalore: { latitude: 12.9716, longitude: 77.5946 },
  "buenos aires": { latitude: -34.6037, longitude: -58.3816 },
  cairo: { latitude: 30.0444, longitude: 31.2357 },
  "cape town": { latitude: -33.9249, longitude: 18.4241 },
  chicago: { latitude: 41.8781, longitude: -87.6298 },
  copenhagen: { latitude: 55.6761, longitude: 12.5683 },
  delhi: { latitude: 28.6139, longitude: 77.209 },
  doha: { latitude: 25.2854, longitude: 51.531 },
  dubai: { latitude: 25.2048, longitude: 55.2708 },
  dublin: { latitude: 53.3498, longitude: -6.2603 },
  edinburgh: { latitude: 55.9533, longitude: -3.1883 },
  florence: { latitude: 43.7696, longitude: 11.2558 },
  "hong kong": { latitude: 22.3193, longitude: 114.1694 },
  istanbul: { latitude: 41.0082, longitude: 28.9784 },
  jakarta: { latitude: -6.2088, longitude: 106.8456 },
  kyoto: { latitude: 35.0116, longitude: 135.7681 },
  lisbon: { latitude: 38.7223, longitude: -9.1393 },
  london: { latitude: 51.5074, longitude: -0.1278 },
  "los angeles": { latitude: 34.0522, longitude: -118.2437 },
  madrid: { latitude: 40.4168, longitude: -3.7038 },
  "mexico city": { latitude: 19.4326, longitude: -99.1332 },
  miami: { latitude: 25.7617, longitude: -80.1918 },
  milan: { latitude: 45.4642, longitude: 9.19 },
  mumbai: { latitude: 19.076, longitude: 72.8777 },
  "new york": { latitude: 40.7128, longitude: -74.006 },
  osaka: { latitude: 34.6937, longitude: 135.5023 },
  paris: { latitude: 48.8566, longitude: 2.3522 },
  prague: { latitude: 50.0755, longitude: 14.4378 },
  reykjavik: { latitude: 64.1466, longitude: -21.9426 },
  "rio de janeiro": { latitude: -22.9068, longitude: -43.1729 },
  rome: { latitude: 41.9028, longitude: 12.4964 },
  "san francisco": { latitude: 37.7749, longitude: -122.4194 },
  seoul: { latitude: 37.5665, longitude: 126.978 },
  singapore: { latitude: 1.3521, longitude: 103.8198 },
  stockholm: { latitude: 59.3293, longitude: 18.0686 },
  sydney: { latitude: -33.8688, longitude: 151.2093 },
  tokyo: { latitude: 35.6762, longitude: 139.6503 },
  toronto: { latitude: 43.6532, longitude: -79.3832 },
  vancouver: { latitude: 49.2827, longitude: -123.1207 },
  vienna: { latitude: 48.2082, longitude: 16.3738 },
};

export function getOfflineCoordinates(label: string): LatLng | null {
  const key = label.split(",")[0].trim().toLowerCase();
  return CITY_COORDINATES[key] ?? null;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export async function geocodeDestination(label: string): Promise<LatLng | null> {
  const offline = getOfflineCoordinates(label);
  if (offline) return offline;

  try {
    const params = new URLSearchParams({
      q: label,
      format: "json",
      limit: "1",
      "accept-language": "en",
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { "User-Agent": "NomadSafe/1.0" },
    });

    if (!response.ok) return null;

    const results = (await response.json()) as NominatimResult[];
    if (!results[0]) return null;

    return {
      latitude: Number(results[0].lat),
      longitude: Number(results[0].lon),
    };
  } catch {
    return null;
  }
}

export async function geocodeDestinations(destinations: string[]): Promise<LatLng[]> {
  const coordinates = await Promise.all(destinations.map(geocodeDestination));
  return coordinates.filter((coord): coord is LatLng => coord !== null);
}
