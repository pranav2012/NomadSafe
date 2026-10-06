import { MUST_DO_ROWS } from "@/features/itinerary/data/mustDos";

export interface MustDo {
  /** The English name; stable across languages, used to remember dismissals. */
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  type: "activity" | "food";
}

interface Sight {
  name: string;
  latitude: number;
  longitude: number;
  type: MustDo["type"];
  labels: Record<string, string>;
}

interface Place {
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  sights: Sight[];
}

let places: Place[] | null = null;

function parse(): Place[] {
  const parsed: Place[] = [];
  for (const line of MUST_DO_ROWS.split("\n")) {
    if (line.startsWith("#")) {
      const [name, , lat, lon, radius] = line.slice(1).split("|");
      parsed.push({ name, latitude: Number(lat), longitude: Number(lon), radiusKm: Number(radius), sights: [] });
      continue;
    }
    const [name, lat, lon, kind, labels] = line.split("|");
    const place = parsed[parsed.length - 1];
    if (!place || !name) continue;
    place.sights.push({
      name,
      latitude: Number(lat),
      longitude: Number(lon),
      type: kind === "f" ? "food" : "activity",
      labels: Object.fromEntries((labels ?? "").split(";").filter(Boolean).map((pair) => [pair.slice(0, pair.indexOf(":")), pair.slice(pair.indexOf(":") + 1)])),
    });
  }
  return parsed;
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** App locale to the bundled label code ("zh-CN" → "zh", "pt-BR" → "pt"). */
const labelLanguage = (locale: string) => locale.slice(0, 2).toLowerCase();

const normalize = (value: string) => value.toLowerCase().replace(/[\s.,'’"()\-–·:;!?]+/g, " ").trim();

/**
 * The bundled must-dos for the destination nearest `point` (within its search radius), best known
 * first, named in the app's language where we have it; skips `exclude` (titles already planned or
 * dismissed keys).
 */
export function mustDosNear(point: { latitude: number; longitude: number }, locale: string, exclude: string[] = []): { place: string; items: MustDo[] } | null {
  places ??= parse();
  let best: { place: Place; km: number } | null = null;
  for (const place of places) {
    const km = distanceKm(point, place);
    if (km <= place.radiusKm && (!best || km < best.km)) best = { place, km };
  }
  if (!best) return null;
  const lang = labelLanguage(locale);
  const skip = new Set(exclude.map(normalize));
  const items = best.place.sights
    .map((sight) => ({ key: sight.name, name: sight.labels[lang] ?? sight.name, latitude: sight.latitude, longitude: sight.longitude, type: sight.type }))
    .filter((item) => !skip.has(normalize(item.key)) && !skip.has(normalize(item.name)));
  return { place: best.place.name, items };
}

/** Must-dos for each destination along a route, once per destination (neighbouring stops can share one), skipping empty lists. */
export function mustDosAlong(stops: { latitude: number; longitude: number }[], locale: string, exclude: string[] = []): { place: string; items: MustDo[] }[] {
  const out: { place: string; items: MustDo[] }[] = [];
  for (const stop of stops) {
    const group = mustDosNear(stop, locale, exclude);
    if (group && group.items.length > 0 && !out.some((other) => other.place === group.place)) out.push(group);
  }
  return out;
}
