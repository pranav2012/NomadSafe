import type { LatLng } from "@/features/trips/services/geocoding";
import { CITY_ROWS, COUNTRY_ROWS } from "./cities";

export type DestinationKind = "city" | "place" | "country" | "online";

export interface DestinationOption {
  id: string;
  label: string;
  kind: DestinationKind;
  detail?: string;
  coordinates?: LatLng;
  placeId?: string;
}

interface City {
  name: string;
  popular: boolean;
  keys: string[];
  country: string;
  coordinates: LatLng;
}

interface IndexEntry {
  option: DestinationOption;
  keys: string[];
  label: string;
}

const MIN_QUERY_LENGTH = 2;
export const DESTINATION_RESULT_LIMIT = 8;

/** Lowercases, strips accents and collapses spaces so "São  Paulo" matches "sao paulo". */
export function foldSearchText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

let cities: City[] | null = null;
let englishCountryNames: Map<string, string> | null = null;

function getCities(): City[] {
  if (cities) return cities;
  cities = CITY_ROWS.split("\n").map((row) => {
    const [name, alternates, country, lat, lon, flag] = row.split("|");
    return {
      name,
      popular: flag === "p",
      keys: [foldSearchText(name), ...(alternates ? alternates.split(";") : [])],
      country,
      coordinates: { latitude: Number(lat), longitude: Number(lon) },
    };
  });
  return cities;
}

function getEnglishCountryNames() {
  englishCountryNames ??= new Map(
    COUNTRY_ROWS.split("\n").map((row) => row.split("|") as [string, string]),
  );
  return englishCountryNames;
}

function countryNamer(locale: string) {
  const english = getEnglishCountryNames();
  let displayNames: Intl.DisplayNames | null = null;
  try {
    displayNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames([locale], { type: "region" }) : null;
  } catch {
    displayNames = null;
  }
  const names = new Map<string, string>();
  return (code: string) => {
    let name = names.get(code);
    if (name === undefined) {
      const localized = displayNames?.of(code);
      name = localized && localized !== code ? localized : (english.get(code) ?? code);
      names.set(code, name);
    }
    return name;
  };
}

let index: { locale: string; entries: IndexEntry[] } | null = null;

/** Countries, then cities by population, labelled in `locale`; city-states (Singapore) appear once. */
function getIndex(locale: string): IndexEntry[] {
  if (index?.locale === locale) return index.entries;

  const nameOf = countryNamer(locale);
  const cityStates = new Set<string>();
  const cityEntries = getCities().map((city): IndexEntry => {
    const countryName = nameOf(city.country);
    const foldedCountry = foldSearchText(countryName);
    const isCityState = foldedCountry === city.keys[0] || foldedCountry.startsWith(`${city.keys[0]} `);
    if (isCityState) cityStates.add(city.country);
    const label = isCityState ? city.name : `${city.name}, ${countryName}`;
    return {
      option: {
        id: `city-${city.country}-${city.name}`,
        label,
        kind: city.popular ? "place" : "city",
        coordinates: city.coordinates,
      },
      keys: city.keys,
      label: foldSearchText(label),
    };
  });
  const countryEntries = [...getEnglishCountryNames().keys()]
    .filter((code) => !cityStates.has(code))
    .map((code): IndexEntry => {
      const label = nameOf(code);
      const english = foldSearchText(getEnglishCountryNames().get(code) ?? label);
      return {
        option: { id: `country-${code}`, label, kind: "country" },
        keys: [...new Set([foldSearchText(label), english])],
        label: foldSearchText(label),
      };
    })
    .sort((first, second) => first.option.label.localeCompare(second.option.label));

  const entries = [...countryEntries, ...cityEntries];
  index = { locale, entries };
  return entries;
}

/** Builds the search index ahead of the first keystroke. */
export function warmDestinationIndex(locale: string) {
  getIndex(locale);
}

/** 0 exact name, 1 name or full-label prefix, 2 word prefix inside a name; -1 none. */
function matchScore(entry: IndexEntry, query: string) {
  let best = entry.label.startsWith(query) ? 1 : -1;
  for (const key of entry.keys) {
    if (key === query) return 0;
    if (key.startsWith(query)) best = 1;
    else if (best === -1 && key.includes(` ${query}`)) best = 2;
  }
  return best;
}

/** Offline matches ranked by `matchScore`, then index order; stops once enough prefix matches exist. */
export function searchOfflineDestinations(
  query: string,
  locale: string,
  selected: string[],
  limit = DESTINATION_RESULT_LIMIT,
): DestinationOption[] {
  const folded = foldSearchText(query);
  if (folded.length < MIN_QUERY_LENGTH) return [];

  const selectedSet = new Set(selected.map(foldSearchText));
  const buckets: DestinationOption[][] = [[], [], []];
  for (const entry of getIndex(locale)) {
    const score = matchScore(entry, folded);
    if (score === -1 || buckets[score].length >= limit || selectedSet.has(entry.label)) continue;
    buckets[score].push(entry.option);
    if (buckets[0].length + buckets[1].length >= limit) break;
  }
  return buckets.flat().slice(0, limit);
}

/** Bundled coordinates for a label like "Lisbon, Portugal"; the country part (any language) only breaks ties. */
export function findOfflineCoordinates(label: string, locale = "en"): LatLng | null {
  const [cityPart, ...rest] = label.split(",");
  const cityKey = foldSearchText(cityPart);
  if (!cityKey) return null;

  const candidates = getCities().filter((city) => city.keys.includes(cityKey));
  if (candidates.length === 0) return null;
  if (candidates.length === 1 || rest.length === 0) return candidates[0].coordinates;

  const countryKey = foldSearchText(rest.join(","));
  const localName = countryNamer(locale);
  const english = getEnglishCountryNames();
  const match = candidates.find(
    (city) =>
      foldSearchText(localName(city.country)) === countryKey ||
      foldSearchText(english.get(city.country) ?? "") === countryKey,
  );
  return (match ?? candidates[0]).coordinates;
}

/** Country code of the bundled city nearest to a point (rough: compares squared degrees). */
export function nearestCityCountry(latitude: number, longitude: number): string | null {
  let best: City | null = null;
  let bestDistance = Infinity;
  const squash = Math.cos((latitude * Math.PI) / 180) ** 2;
  for (const city of getCities()) {
    const dLat = city.coordinates.latitude - latitude;
    const dLon = city.coordinates.longitude - longitude;
    const distance = dLat * dLat + dLon * dLon * squash;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = city;
    }
  }
  return best?.country ?? null;
}

/** A country's name in `locale`, falling back to English, then the code. */
export function countryDisplayName(code: string, locale: string): string {
  return countryNamer(locale)(code);
}

export interface PlaceInText {
  /** As destination search labels it: "Kyoto, Japan", "Bali, Indonesia" or "Japan". */
  label: string;
  kind: "place" | "city" | "country";
  /** ISO country code. */
  country: string;
  /** Cities and popular places only; a country is too broad to pin. */
  coordinates?: LatLng;
}

const MAX_PLACE_WORDS = 4;
const MIN_PLACE_KEY = 3;
const KIND_RANK: Record<PlaceInText["kind"], number> = { place: 0, city: 1, country: 2 };

let placeKeys: { locale: string; byKey: Map<string, PlaceInText> } | null = null;

function getPlaceKeys(locale: string): Map<string, PlaceInText> {
  if (placeKeys?.locale === locale) return placeKeys.byKey;
  const nameOf = countryNamer(locale);
  const byKey = new Map<string, PlaceInText>();
  // Rows are ordered popular places first, then by population, so the first city with a name wins.
  for (const city of getCities()) {
    const countryName = nameOf(city.country);
    const label = foldSearchText(countryName) === city.keys[0] ? city.name : `${city.name}, ${countryName}`;
    const place: PlaceInText = { label, kind: city.popular ? "place" : "city", country: city.country, coordinates: city.coordinates };
    for (const key of city.keys) if (key.length >= MIN_PLACE_KEY && !byKey.has(key)) byKey.set(key, place);
  }
  for (const [code, english] of getEnglishCountryNames()) {
    const place: PlaceInText = { label: nameOf(code), kind: "country", country: code };
    for (const key of [foldSearchText(english), foldSearchText(nameOf(code))]) if (!byKey.has(key)) byKey.set(key, place);
  }
  placeKeys = { locale, byKey };
  return byKey;
}

/**
 * The most specific known place named in free text (a reel caption, a page title), or null:
 * popular places beat cities, cities beat countries, longer names beat shorter ones. Single-word
 * names must be capitalized or a hashtag, so everyday words ("nice", "split") don't count.
 */
export function findPlaceInText(text: string, locale = "en"): PlaceInText | null {
  const byKey = getPlaceKeys(locale);
  const words = [...text.matchAll(/#?[\p{L}\p{M}'’.-]+/gu)].map((match) => match[0]);
  let best: { place: PlaceInText; length: number } | null = null;
  for (let start = 0; start < words.length; start += 1) {
    for (let size = Math.min(MAX_PLACE_WORDS, words.length - start); size >= 1; size -= 1) {
      const raw = words.slice(start, start + size).join(" ");
      const tagged = raw.startsWith("#");
      const first = raw.replace(/^#/, "");
      if (size === 1 && !tagged && /^\p{Ll}/u.test(first)) continue;
      const place = byKey.get(foldSearchText(first.replace(/[.'’]+$/, "")));
      if (!place) continue;
      const better =
        !best ||
        KIND_RANK[place.kind] < KIND_RANK[best.place.kind] ||
        (KIND_RANK[place.kind] === KIND_RANK[best.place.kind] && size > best.length);
      if (better) best = { place, length: size };
      break;
    }
  }
  return best?.place ?? null;
}
